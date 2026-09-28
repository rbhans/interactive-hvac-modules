"""Voxel airflow solver for duct systems, driven from Blender geometry.

Mantaflow (Blender's gas solver) is built for smoke plumes: it won't hold a prescribed
airflow through a duct network. HVAC visualization needs the opposite: known flow rates
in and out of known openings, and the question "where does the air go in between?"

So this solves incompressible, inviscid (potential) flow on a voxel grid:
  - solids come from the real meshes (a ray between neighbouring cell centres),
  - openings ("ports") on the domain faces get prescribed normal velocities,
  - walls are no-flux,
  - velocity = ∇φ with ∇²φ = 0, solved matrix-free by conjugate gradient in numpy.
The result routes air through blade gaps, around obstacles and into the fan inlet, and
conserves mass to the solver tolerance (the bakes refuse to write a field whose port flows
don't balance or whose solve didn't converge). It has no separation or turbulence; the
runtime adds that texture.
"""
import collections

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


class Grid:
    def __init__(self, lo, hi, h):
        self.lo = np.array(lo, dtype=np.float64)
        self.h = float(h)
        self.n = tuple(int(round((hi[i] - lo[i]) / h)) for i in range(3))
        self.hi = self.lo + np.array(self.n) * self.h

    def centers(self):
        ax = [self.lo[i] + (np.arange(self.n[i]) + 0.5) * self.h for i in range(3)]
        return np.meshgrid(*ax, indexing="ij")


def bvh_from_objects(objs, depsgraph):
    verts, polys = [], []
    for ob in objs:
        ev = ob.evaluated_get(depsgraph)
        me = ev.to_mesh()
        mw = ev.matrix_world  # evaluated: correct even in a fresh headless session
        base = len(verts)
        verts.extend(mw @ v.co for v in me.vertices)
        polys.extend([base + i for i in p.vertices] for p in me.polygons)
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys, epsilon=0.0)


def open_faces(grid, bvh):
    """Cut-face geometry: for each axis, True where the segment between a cell centre and its
    +axis neighbour's centre doesn't touch any surface. Thin walls block exactly the faces
    they cross, so blade gaps stay open no matter how thin the blades are."""
    X, Y, Z = grid.centers()
    faces = []
    for ax in range(3):
        d = Vector([1.0 if i == ax else 0.0 for i in range(3)])
        m = np.zeros(grid.n, dtype=bool)
        sl = [slice(None)] * 3
        sl[ax] = slice(0, grid.n[ax] - 1)
        sl = tuple(sl)
        xs, ys, zs = X[sl].ravel(), Y[sl].ravel(), Z[sl].ravel()
        flat = np.zeros(xs.shape, dtype=bool)
        for k in range(xs.size):
            hit = bvh.ray_cast(Vector((xs[k], ys[k], zs[k])), d, grid.h)
            flat[k] = hit[0] is None
        m[sl] = flat.reshape(X[sl].shape)
        faces.append(m)
    return faces


def components(faces):
    """Label regions connected through open faces."""
    n = faces[0].shape
    lab = np.zeros(n, dtype=np.int32)
    cur = 0
    for start in np.ndindex(n):
        if lab[start]:
            continue
        cur += 1
        lab[start] = cur
        q = collections.deque([start])
        while q:
            c = q.popleft()
            for ax in range(3):
                if c[ax] + 1 < n[ax] and faces[ax][c]:
                    nb = list(c)
                    nb[ax] += 1
                    nb = tuple(nb)
                    if not lab[nb]:
                        lab[nb] = cur
                        q.append(nb)
                if c[ax] > 0:
                    nb = list(c)
                    nb[ax] -= 1
                    nb = tuple(nb)
                    if faces[ax][nb] and not lab[nb]:
                        lab[nb] = cur
                        q.append(nb)
    return lab


def solve_potential(faces, h, face_flux, tol=1e-7, maxit=8000):
    """Solve A φ = b, A = negative graph Laplacian over open faces (closed faces are walls).
    face_flux: per-cell net OUTWARD boundary velocity (m/s) from prescribed ports.
    Returns φ with ∇φ = velocity."""

    def A(x):
        y = np.zeros_like(x)
        for ax, m in enumerate(faces):
            d = np.where(m, x - np.roll(x, -1, axis=ax), 0.0)
            y += d
            y -= np.roll(d, 1, axis=ax)
        return y

    b = h * face_flux
    x = np.zeros_like(b)
    r = b - A(x)
    p = r.copy()
    rs = float((r * r).sum())
    b2 = float((b * b).sum()) or 1.0
    it = 0
    for it in range(maxit):
        Ap = A(p)
        denom = float((p * Ap).sum())
        if denom <= 0:
            break
        alpha = rs / denom
        x += alpha * p
        r -= alpha * Ap
        rs_new = float((r * r).sum())
        if rs_new < tol * tol * b2:
            rs = rs_new
            break
        p = r + (rs_new / rs) * p
        rs = rs_new
    return x, it + 1, (rs / b2) ** 0.5


def cell_velocity(phi, faces, h, boundary_vel, links=None):
    """Cell-centred velocity from face gradients. boundary_vel[ax] = (velocity on the −face,
    velocity on the +face) for cells on the domain faces (m/s along +axis). links: see
    face_velocities."""
    vel = np.zeros(phi.shape + (3,), dtype=np.float64)
    for ax, m in enumerate(faces):
        face = np.where(m, (np.roll(phi, -1, axis=ax) - phi) / h, 0.0)  # + face of each cell
        if links is not None:
            face = np.where(np.isnan(links[ax]), face, np.nan_to_num(links[ax]))
        minus = np.roll(face, 1, axis=ax)  # − face of each cell
        sl0 = [slice(None)] * 3
        sl0[ax] = 0
        minus[tuple(sl0)] = boundary_vel[ax][0]
        sl1 = [slice(None)] * 3
        sl1[ax] = -1
        face[tuple(sl1)] = boundary_vel[ax][1]
        vel[..., ax] = 0.5 * (face + minus)
    return vel


# ── staggered (face) velocities and wall-aware tracing ──────────────────────────────────────


def face_velocities(phi, faces, h, ports, links=None):
    """Velocities on cell faces, the solver's native quantity, plus which faces are walls.

    ports: {"x-": (vel, open), "x+": (vel, open)} with (ny, nz) arrays giving the prescribed
    velocity along +x and which boundary faces are openings. Every other boundary face is a wall.
    links: optional per-axis arrays (grid shape) of prescribed velocities along +axis on the +face
    of each cell, NaN elsewhere. Those faces are closed to the solve (their flow enters it as a
    source/sink pair, see link_faces) but open to particles, at that velocity.
    Returns ([ux, uy, uz], [bx, by, bz]) with shapes (nx+1, ny, nz), (nx, ny+1, nz), (nx, ny, nz+1);
    b* is True where the face is a wall.
    """
    nx, ny, nz = phi.shape
    u = [np.zeros((nx + 1, ny, nz)), np.zeros((nx, ny + 1, nz)), np.zeros((nx, ny, nz + 1))]
    b = [np.ones(a.shape, dtype=bool) for a in u]
    for ax in range(3):
        grad = (np.roll(phi, -1, axis=ax) - phi) / h
        inner = [slice(None)] * 3
        inner[ax] = slice(1, phi.shape[ax])
        src = [slice(None)] * 3
        src[ax] = slice(0, phi.shape[ax] - 1)
        u[ax][tuple(inner)] = np.where(faces[ax][tuple(src)], grad[tuple(src)], 0.0)
        b[ax][tuple(inner)] = ~faces[ax][tuple(src)]
        if links is not None:
            lk = links[ax][tuple(src)]
            sel = ~np.isnan(lk)
            u[ax][tuple(inner)][sel] = lk[sel]
            b[ax][tuple(inner)][sel] = False
    vel, open_ = ports["x-"]
    u[0][0] = vel
    b[0][0] = ~open_
    vel, open_ = ports["x+"]
    u[0][-1] = vel
    b[0][-1] = ~open_
    return u, b


def trace(u, b, lo, h, seeds, dt=0.02, steps=20000):
    """Advect seed points through the face-velocity field, colliding with wall faces exactly
    the way the runtime does. Returns final positions and whether each left through an opening.
    `steps` * `dt` is 400 s of air travel by default: long enough that a slow detour ends at an
    opening instead of hiding as "stuck"."""
    lo = np.asarray(lo, dtype=np.float64)
    nx, ny, nz = u[0].shape[0] - 1, u[1].shape[1] - 1, u[2].shape[2] - 1
    n = np.array([nx, ny, nz])
    p = np.array(seeds, dtype=np.float64)
    alive = np.ones(len(p), dtype=bool)
    exited = np.zeros(len(p), dtype=bool)

    def sample(q):
        g = (q - lo) / h
        c = np.clip(np.floor(g).astype(int), 0, n - 1)
        f = np.clip(g - c, 0.0, 1.0)
        i, j, k = c[:, 0], c[:, 1], c[:, 2]
        vx = u[0][i, j, k] * (1 - f[:, 0]) + u[0][i + 1, j, k] * f[:, 0]
        vy = u[1][i, j, k] * (1 - f[:, 1]) + u[1][i, j + 1, k] * f[:, 1]
        vz = u[2][i, j, k] * (1 - f[:, 2]) + u[2][i, j, k + 1] * f[:, 2]
        return np.stack([vx, vy, vz], axis=1), c

    for _ in range(steps):
        if not alive.any():
            break
        q = p[alive]
        v, c0 = sample(q)
        sp = np.linalg.norm(v, axis=1, keepdims=True)
        step = v * np.minimum(dt, 0.45 * h / np.maximum(sp, 1e-9))
        mid, _ = sample(q + 0.5 * step)
        spm = np.linalg.norm(mid, axis=1, keepdims=True)
        nq = q + mid * np.minimum(dt, 0.45 * h / np.maximum(spm, 1e-9))
        c1 = np.floor((nq - lo) / h).astype(int)
        # resolve the move one axis at a time, updating the cell as we go, so a diagonal step
        # can't slip between two walls that meet at a corner
        cur = c0.copy()
        for ax in range(3):
            moved = c1[:, ax] != cur[:, ax]
            if not moved.any():
                continue
            idx = [np.clip(cur[:, a], 0, n[a] - 1) for a in range(3)]
            idx[ax] = np.clip(np.maximum(cur[:, ax], c1[:, ax]), 0, n[ax])
            wall = b[ax][idx[0], idx[1], idx[2]] & moved
            edge = lo[ax] + (cur[:, ax] + np.where(c1[:, ax] > cur[:, ax], 0.999, 0.001)) * h
            nq[wall, ax] = edge[wall]
            go = moved & ~wall
            cur[go, ax] = c1[go, ax]
        out = np.any((nq < lo) | (nq > lo + n * h), axis=1)
        idx_alive = np.nonzero(alive)[0]
        p[idx_alive] = nq
        exited[idx_alive[out]] = True
        alive[idx_alive[out]] = False
    return p, exited


# ── airspace, sanity checks, storage ────────────────────────────────────────────────────────


def box_mask(X, Y, Z, box):
    """Cells whose centre lies in box = ((x0, x1), (y0, y1), (z0, z1))."""
    (x0, x1), (y0, y1), (z0, z1) = box
    return (X >= x0) & (X <= x1) & (Y >= y0) & (Y <= y1) & (Z >= z0) & (Z <= z1)


def restrict(faces, allowed):
    """Close every face that touches a cell outside `allowed`, so only the intended airspace
    carries air. The domain is a box; without this, open outdoor space around a unit can form
    loops between openings that the real building doesn't have."""
    for ax in range(3):
        faces[ax] &= allowed & np.roll(allowed, -1, axis=ax)  # the last layer is closed already
    return faces


def link_faces(blocked, lab, region, main):
    """Faces (per axis, on the +face of each cell) in `blocked` that join a cell of component
    `region` to a cell of component `main`, and the direction of each (+1 where the region cell
    is the lower-index one)."""
    out = []
    for ax, m in enumerate(blocked):
        nb = np.roll(lab, -1, axis=ax)  # the last layer never has a +face (m is False there)
        fwd = m & (lab == region) & (nb == main)
        rev = m & (lab == main) & (nb == region)
        out.append((fwd, rev))
    return out


def add_links(out, links, pairs, q, h):
    """Carry q m³/s from a sealed region into the main airspace, spread evenly over the given
    faces (from link_faces), as a sink on the region side and a source on the main side, so both
    stay balanced. Writes the face velocities into `links` (NaN = not a link). Returns the face count."""
    count = sum(int(f.sum() + r.sum()) for f, r in pairs)
    if count == 0:
        return 0
    v = q / (count * h * h)
    for ax, (fwd, rev) in enumerate(pairs):
        up = np.roll(fwd, 1, axis=ax)   # the +ax neighbour of a forward face's cell
        dn = np.roll(rev, 1, axis=ax)
        out[fwd] += v                   # region cell: leaves through its +face
        out[up] -= v                    # main cell: enters through its -face
        out[dn] += v                    # region cell (upper): leaves through its -face
        out[rev] -= v                   # main cell (lower): enters through its +face
        links[ax][fwd] = v
        links[ax][rev] = -v
    return count


def assert_balanced(out, lab, h, label="flow", rtol=1e-9):
    """Prescribed port flows must sum to zero in every connected region, or the Neumann problem
    has no solution (CG then never converges and the field isn't divergence-free)."""
    A = h * h
    total = float(np.abs(out).sum()) * A
    if total <= 0:
        raise SystemExit(f"[{label}] no port carries any flow")
    for c in np.unique(lab[out != 0]):
        net = float(out[lab == c].sum()) * A
        if abs(net) > rtol * total:
            raise SystemExit(f"[{label}] port flows don't balance in connected region {c}: net {net:+.5f} m³/s "
                             f"(an opening is sealed off from the others?)")


def assert_converged(resid, iters, label="flow", tol=1e-5):
    if not np.isfinite(resid) or resid > tol:
        raise SystemExit(f"[{label}] potential solve did not converge: relative residual {resid:.2e} after "
                         f"{iters} iterations (limit {tol:.0e})")


def port_box(ys, zs, x0, x1, h, inset=0.01):
    """Emission box over a port's open cells (their centres ys, zs), pulled `inset` inside the
    cells' outer edges so no seed starts in a wall or a sealed pocket."""
    half = h / 2
    return {
        "lo": [round(float(x0), 3), round(float(ys.min()) - half + inset, 3), round(float(zs.min()) - half + inset, 3)],
        "hi": [round(float(x1), 3), round(float(ys.max()) + half - inset, 3), round(float(zs.max()) + half - inset, 3)],
    }


def emit_coverage(grid, lab, regions, box, n=4000, seed=1):
    """Fraction of an emission box whose cells belong to the connected airspace: a component
    label, or a collection of them (regions that carry flow)."""
    rng = np.random.default_rng(seed)
    p = rng.uniform(box["lo"], box["hi"], size=(n, 3))
    c = np.clip(np.floor((p - grid.lo) / grid.h).astype(int), 0, np.array(grid.n) - 1)
    return float(np.isin(lab[c[:, 0], c[:, 1], c[:, 2]], np.atleast_1d(regions)).mean())


BLOCKED = -128  # int8 sentinel for a wall face


def _quantize(v, vmax):
    return np.clip(np.round(np.sign(v) * np.sqrt(np.minimum(np.abs(v) / vmax, 1.0)) * 127.0), -127, 127)


def _dequantize(q, vmax):
    return np.sign(q) * (q / 127.0) ** 2 * vmax


def _diffused(v, wall, vmax):
    """Quantize one boundary plane of face velocities, carrying each face's rounding error to the
    next open face, so the plane's total flow survives quantization (every face of a port has the
    same velocity, so plain rounding would bias the whole port the same way)."""
    q = np.zeros(v.shape)
    carry = 0.0
    for idx in zip(*np.nonzero(~wall)):
        t = v[idx] + carry
        q[idx] = _quantize(t, vmax)
        carry = t - _dequantize(q[idx], vmax)
    return q


def encode(u, walls, pct=99.5, vmin=5.5):
    """Face velocities as int8 with square-root companding (slow air keeps resolution next to
    jets), wall faces = BLOCKED, each array written x fastest (transposed to z, y, x).

    vmax is the `pct` percentile of the moving faces' speeds, but at least `vmin` m/s. The few
    faces above it (the fan-inlet jet) are clipped to ±vmax: the runtime caps on-screen speed
    well below that anyway, and a vmax set by the jet would leave every duct and port with a
    coarse, biased step. The two x boundary planes (the openings) are quantized with error
    diffusion so each opening's total flow is kept. Decode: v = sign(q) * (q/127)^2 * vmax.
    Returns (arrays, vmax, fraction of moving faces clipped)."""
    speeds = np.concatenate([np.abs(a[~w]) for a, w in zip(u, walls)])
    speeds = speeds[speeds > 0]
    vmax = max(float(vmin), float(np.percentile(speeds, pct))) if speeds.size else float(vmin)
    out = []
    for ax, (a, w) in enumerate(zip(u, walls)):
        q = _quantize(a, vmax)
        if ax == 0:
            for i in (0, -1):
                q[i] = _diffused(a[i], w[i], vmax)
        q = q.astype(np.int8)
        q[w] = BLOCKED
        out.append(q.transpose(2, 1, 0).copy())
    clipped = float((speeds > vmax).mean()) if speeds.size else 0.0
    return out, vmax, clipped


def encode_peak(u, walls):
    """The previous encoding (vmax = the fastest face, plain rounding), kept for comparison."""
    vmax = max(float(np.abs(a).max()) for a in u) or 1.0
    out = []
    for a, w in zip(u, walls):
        q = _quantize(a, vmax).astype(np.int8)
        q[w] = BLOCKED
        out.append(q.transpose(2, 1, 0).copy())
    return out, vmax


def decode(arrays, vmax):
    """Inverse of encode (what the browser sees), back in (x, y, z) index order."""
    u = []
    for q in arrays:
        q = q.transpose(2, 1, 0).astype(np.float64)
        v = np.sign(q) * (q / 127.0) ** 2 * vmax
        v[q == BLOCKED] = 0.0
        u.append(v)
    return u


def jet_cells(u, vmax):
    """Cells with a face faster than vmax (where encode clips)."""
    shape = (u[1].shape[0], u[0].shape[1], u[0].shape[2])
    fast = np.zeros(shape, dtype=bool)
    for ax, a in enumerate(u):
        f = np.abs(a) > vmax * (1 + 1e-9)
        lo = [slice(None)] * 3
        hi = [slice(None)] * 3
        lo[ax] = slice(0, -1)
        hi[ax] = slice(1, None)
        fast |= f[tuple(lo)] | f[tuple(hi)]
    return fast


def divergence(u, h, skip=None):
    """Per-cell net outflow (m³/s) of a staggered face-velocity field, summarised:
    net = total over all cells (= net flow through the openings), l1 = Σ|cell|, max = worst cell.
    With a `skip` cell mask (e.g. jet_cells), also l1/max over the other cells."""
    d = (np.diff(u[0], axis=0) + np.diff(u[1], axis=1) + np.diff(u[2], axis=2)) * h * h
    r = {"net": round(float(d.sum()), 5), "l1": round(float(np.abs(d).sum()), 4), "max": round(float(np.abs(d).max()), 5)}
    if skip is not None:
        rest = np.abs(d[~skip])
        r["l1_outside_jets"] = round(float(rest.sum()), 4)
        r["max_outside_jets"] = round(float(rest.max()), 5)
    return r
