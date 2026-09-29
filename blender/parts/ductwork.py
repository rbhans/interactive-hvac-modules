"""Sheet-metal and duct helpers that add geometry to an existing MeshBuilder
(so one object can hold several panels, flanges and fittings), plus flex duct
and hanger pieces.

Round pieces are revolved with the same vertex placement as H.circle_pts
(phase 0.5), so a round collar lines up exactly with the circular hole that
MeshBuilder.plate cuts for it: bores meet hole walls without slivers, which
keeps the air path sealed.
"""
import math

from mathutils import Matrix, Vector

import hvaclab as H

AX = (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
# the order of H._BOX_FACES
FACE_KEYS = ("-x", "+x", "-y", "+y", "-z", "+z")
CUT = "mat_cut"

# frame whose local X is world +Z (local Y = world X, local Z = world Y): a
# vertical lathe axis whose rings match a Z-thin plate's circle hole
UP_FRAME = H.basis((0, 0, 1), (1, 0, 0), (0, 1, 0))


def up_frame(x, y):
    return Matrix.Translation((x, y, 0.0)) @ UP_FRAME


def box6(mb, lo, hi, mats=None, default="mat_duct", xf=H.IDENT, bw=1.0):
    """Box with its own material per face: mats = {"-x": mat, "+z": mat, ...}.
    Faces poured in mat_cut get no bevel weight, so section cuts stay crisp."""
    mats = mats or {}
    c = {}
    for ix in (0, 1):
        for iy in (0, 1):
            for iz in (0, 1):
                c[(ix, iy, iz)] = mb._v(xf, (hi[0] if ix else lo[0], hi[1] if iy else lo[1], hi[2] if iz else lo[2]))
    for key, quad in zip(FACE_KEYS, H._BOX_FACES):
        m = mats.get(key, default)
        mb._face([c[k] for k in quad], m, 0.0 if m == CUT else bw)


def panel(mb, lo, hi, mat="mat_duct", hole=None, bw=1.0):
    """Axis-aligned panel lo..hi into `mb`; the thinnest axis is the thickness
    (like parts.housing.panel). hole, in world coords on the panel's (u, v) =
    the two axes after the thin one, cyclically: X-thin -> (y, z), Y-thin ->
    (z, x), Z-thin -> (x, y). ('rect', u0, u1, v0, v1) or ('circle', cu, cv, r, seg)."""
    lo, hi = Vector(lo), Vector(hi)
    ext = [hi[i] - lo[i] for i in range(3)]
    t = min(range(3), key=lambda i: ext[i])
    u, v = (t + 1) % 3, (t + 2) % 3
    ctr = (lo + hi) / 2
    xf = H.basis(AX[u], AX[v], AX[t], ctr)
    outer = (lo[u] - ctr[u], hi[u] - ctr[u], lo[v] - ctr[v], hi[v] - ctr[v])
    loc = None
    if hole is not None:
        if hole[0] == "rect":
            _, a0, a1, b0, b1 = hole
            loc = ("rect", a0 - ctr[u], a1 - ctr[u], b0 - ctr[v], b1 - ctr[v])
        else:
            _, cu, cv, r, seg = hole
            loc = ("circle", cu - ctr[u], cv - ctr[v], r, seg)
    mb.plate(outer, hi[t] - lo[t], mat, xf, hole=loc, bw=bw)


def flange(mb, axis, a0, a1, inner_lo, inner_hi, width, mat="mat_frame", bw=1.0):
    """Rectangular flange ring, thickness a0..a1 along world `axis`, around the
    opening inner_lo..inner_hi (3-vectors; their `axis` component is ignored),
    grown outward by `width`."""
    lo = [inner_lo[i] - width for i in range(3)]
    hi = [inner_hi[i] + width for i in range(3)]
    lo[axis], hi[axis] = a0, a1
    u, v = (axis + 1) % 3, (axis + 2) % 3
    panel(mb, lo, hi, mat, hole=("rect", inner_lo[u], inner_hi[u], inner_lo[v], inner_hi[v]), bw=bw)


def lathe(mb, profile, seg, mat, xf=H.IDENT, bw=1.0, phase=0.5):
    """Revolve a closed (axial, radius) loop about local X of xf. Ring k sits at
    angle 2*pi*(k + phase)/seg from local +Y toward local +Z: the placement of
    H.circle_pts, i.e. of MeshBuilder.plate's circle holes."""
    rings = []
    for i in range(seg):
        a = 2 * math.pi * (i + phase) / seg
        ca, sa = math.cos(a), math.sin(a)
        rings.append([mb._v(xf, (x, r * ca, r * sa)) for x, r in profile])
    n = len(profile)
    for i in range(seg):
        A, B = rings[i], rings[(i + 1) % seg]
        for j in range(n):
            k = (j + 1) % n
            mb._face([A[j], A[k], B[k], B[j]], mat, bw)


def tube_wall(mb, x0, x1, r_in, r_out, seg, mat, xf=H.IDENT, bw=1.0):
    """Open-ended round duct wall (annulus) from local x0 to x1."""
    lathe(mb, [(x0, r_in), (x1, r_in), (x1, r_out), (x0, r_out)], seg, mat, xf, bw)


def arc_ring(mb, x0, x1, r0, r1, ang0, ang1, steps, mat, xf=H.IDENT, bw=1.0):
    """Annular sector (x0..x1 along local X, radii r0..r1), angles in degrees
    from local +Y toward local +Z. Closed solid with end caps."""
    rows = []
    for k in range(steps + 1):
        a = math.radians(ang0 + (ang1 - ang0) * k / steps)
        c, s = math.cos(a), math.sin(a)
        rows.append([(x0, r0 * c, r0 * s), (x1, r0 * c, r0 * s), (x1, r1 * c, r1 * s), (x0, r1 * c, r1 * s)])
    mb.solid_strip(rows, mat, xf, bw)


def square_lathe(mb, profile, mat, xf=H.IDENT, bw=1.0):
    """Sweep a closed (half_size, z) loop around a square: square frames,
    frustum bands and louver cones with mitred corners."""
    corners = ((1, 1), (-1, 1), (-1, -1), (1, -1))
    rings = [[mb._v(xf, (sx * d, sy * d, z)) for d, z in profile] for sx, sy in corners]
    n = len(profile)
    for i in range(4):
        A, B = rings[i], rings[(i + 1) % 4]
        for j in range(n):
            k = (j + 1) % n
            mb._face([A[j], A[k], B[k], B[j]], mat, bw)


def flex_profile(z_bot, z_top, r_in, r_ridge, r_valley, pitch, end=0.02, r_end=None):
    """Closed (axial, radius) loop for a hollow flex duct run along its axis:
    straight bore r_in, a ribbed jacket (ridge/valley every pitch/2) and plain
    cuffs of `end` length where the draw bands clamp it."""
    r_end = r_valley if r_end is None else r_end
    a, b = z_bot + end, z_top - end
    n = max(2, int(round((b - a) / (pitch / 2))))
    if n % 2:
        n += 1
    outer = [(z_top, r_end), (b, r_end)]
    for k in range(1, n):
        outer.append((b - (b - a) * k / n, r_ridge if k % 2 else r_valley))
    outer += [(a, r_end), (z_bot, r_end)]
    return [(z_bot, r_in), (z_top, r_in)] + outer


def ribbed_tube(mb, route, r_ridge, r_valley, pitch, seg, mat, end=0.02, r_end=None, bw=0.0):
    """Solid flex duct swept along a piping.Route (parallel-transport frames):
    ridges and valleys alternate every pitch/2, plain cuffs at both ends."""
    r_end = r_valley if r_end is None else r_end
    L = route.length
    a, b = end, L - end
    n = max(2, int(round((b - a) / (pitch / 2))))
    ss = [0.0] + [a + (b - a) * k / n for k in range(n + 1)] + [L]
    rr = [r_end] + [r_end if k in (0, n) else (r_ridge if k % 2 else r_valley) for k in range(n + 1)] + [r_end]
    P = [route.locate(s)[0] for s in ss]
    T = []
    for i in range(len(P)):
        d = P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]
        T.append(d.normalized())
    hint = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    N = [(hint - T[0] * hint.dot(T[0])).normalized()]
    for i in range(1, len(P)):
        N.append((N[-1] - T[i] * N[-1].dot(T[i])).normalized())
    rings = []
    for i in range(len(P)):
        Bn = T[i].cross(N[i])
        rings.append([mb.bm.verts.new(P[i] + (N[i] * math.cos(2 * math.pi * k / seg) +
                                             Bn * math.sin(2 * math.pi * k / seg)) * rr[i]) for k in range(seg)])
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(seg):
            m = (k + 1) % seg
            mb._face([A[k], A[m], B[m], B[k]], mat, bw)
    mb._face(list(reversed(rings[0])), mat, bw)
    mb._face(rings[-1], mat, bw)


def rod(mb, x, y, z0, z1, r=0.005, mat="mat_steel"):
    """Threaded hanger rod (vertical)."""
    mb.cylinder((x, y, z0), (x, y, z1), r, 8, mat, bw=0.0)


def nut(mb, x, y, z0, z1, r=0.009, mat="mat_steel"):
    mb.cylinder((x, y, z0), (x, y, z1), r, 6, mat, bw=0.5)


def trapeze(mb, bar_lo, bar_hi, rods, z_top, mat="mat_steel"):
    """Strut trapeze: a bar lo..hi hung on vertical rods (x, y) that run from
    just below the bar up to z_top, with a nut under and over the bar."""
    mb.box(bar_lo, bar_hi, mat, bw=0.6)
    z0, z1 = bar_lo[2], bar_hi[2]
    for x, y in rods:
        rod(mb, x, y, z0 - 0.018, z_top)
        nut(mb, x, y, z0 - 0.009, z0)
        nut(mb, x, y, z1, z1 + 0.009)


def cut_faces(obj, normal, d, mat=CUT, eps=1e-4):
    """Pour a section: faces lying in the plane n.p = d and facing n (world)
    get `mat`, and their edges lose the bevel weight so the cut stays crisp."""
    me = obj.data
    mw = H.world_matrix(obj)
    rot = mw.to_3x3()
    n = Vector(normal).normalized()
    names = [m.name for m in me.materials]
    if mat not in names:
        me.materials.append(H.material(mat))
        names.append(mat)
    mi = names.index(mat)
    bw = me.attributes.get("bevel_weight_edge")
    ekey = {tuple(sorted(e.vertices)): e.index for e in me.edges}
    count = 0
    for p in me.polygons:
        if (rot @ p.normal).normalized().dot(n) > 0.999 and abs((mw @ p.center).dot(n) - d) < eps:
            p.material_index = mi
            count += 1
            if bw is not None:
                for ek in p.edge_keys:
                    bw.data[ekey[tuple(sorted(ek))]].value = 0.0
    me.update()
    return count
