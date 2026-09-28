"""Bake the economizer's airflow fields.

For a handful of damper positions: pose the blades, voxelize the unit, prescribe the port
flows the economizer model predicts at that position, solve for the velocity field and
write it to public/lab/economizer/flow.{json,bin.gz}.

In Blender:  runpy.run_path(".../blender/sims/economizer_flow.py", run_name="__main__")
Headless:    blender -b --factory-startup -P blender/sims/economizer_flow.py
"""
import gzip
import json
import math
import os
import re
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import flowsolve as F  # noqa: E402

OUT_DIR = os.path.join(ROOT, "public", "lab", "economizer")

# ── domain (Blender Z-up, meters) ────────────────────────────────────────────
H = 0.05
# y spans exactly the unit's width: no sliver of "outside" air along its side walls
LO = (-1.75, -0.60, 0.12)
HI = (2.60, 0.60, 2.12)
SUPPLY = 1.2  # m³/s; only the shape of the field matters, the runtime rescales speed

# Positions to bake. Below ~25 % the opposed blades close the gaps below the grid size.
POSITIONS = [0.25, 0.4, 0.55, 0.75, 1.0]

# ── the airspace (Blender coords, from blender/modules/economizer.py) ────────────────────
# Only these regions carry air: the outdoor zone in front of the dampers (intake below the
# split, relief discharge above it), the unit, and the two ducts. Everything else in the box
# is closed off before solving: the slot under the unit floor, the space beside and above the
# return duct, and the space around the supply duct past the end wall. Left open, those form
# an outdoor loop from the relief discharge back to the OA intake that the real unit doesn't
# have (at 75 % it carried ~12 % of the relief air back into the intake).
XP = -1.14  # inner face of the end dampers, where the housing panels begin
UNIT = ((XP, 1.40), (-0.60, 0.60), (0.15, 1.35))
RA_DUCT = ((XP, 2.60), (-0.45, 0.45), (1.347, 2.05))
SA_DUCT = ((1.37, 2.60), (-0.40, 0.40), (0.35, 1.15))
SPLIT_Z = 1.35  # the OA damper's head / EA damper's sill: intake below, relief above

# Parts that aren't obstacles to the air: the fan wheel (air passes through it), the
# filter media (porous), the thin sensor element, and everything outside the airstream.
# Keep housing_edges IN: the panels are inset inside that frame, so without it every edge
# of the unit is a 3.5 cm slot and the fan pulls return air straight through them.
EXCLUDE = re.compile(
    r"^(filter_media|fan_wheel|mat_sensor|mat_sensor_head|link_rod_\d+|oa_crank|ea_crank|"
    r"oa_actuator|oa_actuator_hub|base_rail_\d+|site_.*)$"
)

# ── the economizer model's damper math (keep in sync with src/modules/economizer/model.ts) ──
LEAK = 0.006
K = {"opposed": 2.5, "parallel": 1.75}
AUTHORITY = 0.1
BALANCE = 1.0
EXFIL = 0.06


def installed(x, n=AUTHORITY, k=K["opposed"]):
    x = min(1.0, max(0.0, x))
    f = LEAK + (1 - LEAK) * x ** k
    return 1 / math.sqrt(n / (f * f) + (1 - n))


def oa_fraction(p):
    qo = installed(p)
    qr = BALANCE * installed(1 - p)
    return qo / (qo + qr)


# Where outside air enters, for particle emission (Blender coords): the whole OA damper face,
# just inside the field. It spans the whole opening: which streamtube a particle starts in
# decides where it ends up. The return-air box is derived from the return duct's open port
# cells in bake_state (so no seed starts inside a duct wall or a sealed pocket).
EMIT_OA = {"lo": [LO[0] + 0.01, -0.6, 0.16], "hi": [LO[0] + 0.1, 0.6, 1.34]}

# Bake gates
OA_TO_SUPPLY_MIN = 0.98   # traced outside air that must reach the supply duct
RA_SPLIT_WARN = 0.06      # traced return-air relief share vs the model
EMIT_COVERAGE_MIN = 0.99  # share of each emission box inside the connected airspace


def ensure_scene():
    """The economizer scene, built fresh if this Blender session doesn't have it (headless).
    Builds geometry only; it never re-exports the GLB. Either way the scene must pass the
    build's self-check: in a live session another module's scene can already own names like
    `housing_front`, and Blender then names ours `housing_front.001`, which the obstacle
    filters below would silently misread."""
    for p in (os.path.join(ROOT, "blender", "lib"), os.path.join(ROOT, "blender")):
        if p not in sys.path:
            sys.path.insert(0, p)
    import hvaclab as H_

    sc = bpy.data.scenes.get("economizer")
    if not (sc and len(sc.objects) > 20):
        import runpy

        mod = runpy.run_path(os.path.join(ROOT, "blender", "modules", "economizer.py"), run_name="hvac_module_economizer")
        sc = H_.reset_scene("economizer")
        H_.activate_scene(sc)
        mod["build"](sc)
    check_scene(sc, H_)
    return sc


def check_scene(scene, H_):
    errors = H_.self_check(scene)
    if errors:
        renamed = sorted(o.name for o in scene.objects if re.search(r"\.\d{3}$", o.name))
        hint = ""
        if renamed:
            hint = (f"\n  {len(renamed)} objects carry Blender's .NNN suffix (e.g. {', '.join(renamed[:4])}): another scene "
                    "in this session already uses those names. Bake headless (npm run assets:flow) or remove the "
                    "other module's scene first.")
        raise SystemExit(f"[flow] scene '{scene.name}' fails the build self-check:\n  " + "\n  ".join(errors[:20]) + hint)


def pose(scene, p):
    """Rotate the blades about their local X (post-multiplied, so parents don't matter).
    Returns the original local matrices for restoring."""
    saved = {}
    for o in scene.objects:
        m = re.match(r"^(oa|ra|ea)_blade_\d+$", o.name)
        if m:
            saved[o.name] = o.matrix_basis.copy()
            lo, hi = o["range"]
            q = (1 - p) if m.group(1) == "ra" else p
            o.matrix_basis = o.matrix_basis @ Matrix.Rotation(math.radians(lo + (hi - lo) * q), 4, "X")
    if not saved:
        raise SystemExit("[flow] no damper blades found to pose")
    return saved


def scene_depsgraph(scene):
    """The scene's own evaluated depsgraph; bpy.context's may belong to another scene (headless)."""
    dg = scene.view_layers[0].depsgraph
    dg.update()
    return dg


def voxelize(scene, grid, p, porous=()):
    """Open faces at damper position p, restricted to the airspace. Blades of the dampers named
    in `porous` are left out of the obstacles (see bake_state)."""
    saved = pose(scene, p)
    dg = scene_depsgraph(scene)
    skip = re.compile(r"^(%s)_blade_\d+$" % "|".join(porous)) if porous else None
    obstacles = [o for o in scene.objects
                 if o.type == "MESH" and not EXCLUDE.match(o.name) and not (skip and skip.match(o.name))]
    bvh = F.bvh_from_objects(obstacles, dg)
    for name, basis in saved.items():
        scene.objects[name].matrix_basis = basis
    scene_depsgraph(scene)

    faces = F.open_faces(grid, bvh)
    X, Y, Z = grid.centers()
    # keep the solve to the real airspace (see UNIT / RA_DUCT / SA_DUCT above)
    allowed = (X < XP) | F.box_mask(X, Y, Z, UNIT) | F.box_mask(X, Y, Z, RA_DUCT) | F.box_mask(X, Y, Z, SA_DUCT)
    F.restrict(faces, allowed)
    # separate the intake from the relief discharge in front of the dampers (the hood's job
    # outside, and the damper rails and roof inside) all the way to where the housing panels begin
    k = int(round((SPLIT_Z - grid.lo[2]) / grid.h)) - 1  # z-face nearest the split
    faces[2][:, :, k][X[:, :, k] < XP] = False
    return faces


PORT_SIDE = {"oa": 0, "ea": 0, "ra": -1, "sa": -1}  # which x face each opening is on


def find_ports(grid, faces):
    """Port cells on the two x faces, and the connected regions of the airspace. `main` is the
    region the supply outlet sees."""
    X, Y, Z = grid.centers()
    z0, zN, yN = Z[0], Z[-1], Y[-1]
    ports = {
        "oa": z0 < SPLIT_Z,
        "ea": z0 > SPLIT_Z,
        "ra": (zN > 1.36) & (zN < 2.05) & (np.abs(yN) < 0.45),
        "sa": (zN > 0.35) & (zN < 1.15) & (np.abs(yN) < 0.40),
    }
    lab = F.components(faces)
    if not ports["sa"].any():
        raise SystemExit("[flow] no supply port cells")
    main = int(np.bincount(lab[-1][ports["sa"]]).argmax())
    return ports, lab, main


# How open each damper is at OA damper position p (the relief is linked to OA, the return
# damper opposes it). Below NEARLY_CLOSED a damper's blade gaps can close below the grid size.
OPENING = {"oa": lambda p: p, "ea": lambda p: p, "ra": lambda p: 1 - p}
NEARLY_CLOSED = 0.5


def bake_state(scene, grid, p):
    f = oa_fraction(p)
    q_oa = f * SUPPLY
    q_ramix = (1 - f) * SUPPLY
    q_ea = max(0.0, f - EXFIL) * SUPPLY
    q_ra = q_ramix + q_ea
    need = {"oa": q_oa, "ra": q_ra, "ea": q_ea}  # every opening the model gives flow to
    A = grid.h * grid.h

    faces = voxelize(scene, grid, p)
    raw, lab, main = find_ports(grid, faces)
    ports = {k_: raw[k_] & (lab[PORT_SIDE[k_]] == main) for k_ in raw}
    sealed = [k_ for k_, q in need.items() if q > 0 and not ports[k_].any()]

    # A nearly-closed damper still passes what the model says (its leakage plus blade gaps finer
    # than the grid). When that seals an opening's region off from the supply at grid resolution,
    # carry the region's net flow across that damper's blade plane explicitly: evenly over the
    # faces its blades block, one way only. (Simply dropping the blades would let the potential
    # flow run both ways through the damper, e.g. outside air up into the return and out the relief.)
    links = [np.full(grid.n, np.nan) for _ in range(3)]
    out = np.zeros(grid.n)
    carried = {}
    if sealed:
        closing = tuple(d for d, opening in OPENING.items() if opening(p) < NEARLY_CLOSED)
        if not closing:
            raise SystemExit(f"[flow] position {p}: the {sealed} opening(s) are sealed off from the supply, and no "
                             "damper is nearly closed. Check the blade gaps / obstacle meshes.")
        blocked = [o_ & ~c_ for o_, c_ in zip(voxelize(scene, grid, p, porous=closing), faces)]
        regions = {}
        for k_ in sealed:
            cells = lab[PORT_SIDE[k_]][raw[k_]]
            regions.setdefault(int(np.bincount(cells).argmax()), []).append(k_)
        for region, keys in regions.items():
            for k_ in keys:
                ports[k_] = raw[k_] & (lab[PORT_SIDE[k_]] == region)
            pairs = F.link_faces(blocked, lab, region, main)
            if not any(fw.any() or rv.any() for fw, rv in pairs):
                raise SystemExit(f"[flow] position {p}: the {keys} opening(s) are sealed off from the supply and not "
                                 f"behind the nearly-closed {list(closing)} damper(s). Check the obstacle meshes.")
            carried[region] = {"openings": keys, "pairs": pairs}
        print(f"[flow] position {p}: {sealed} sealed off by the nearly-closed {list(closing)} damper(s) at "
              f"{grid.h * 100:.0f} cm resolution; carrying their flow across its blade plane")
    oa_port, ea_port, ra_port, sa_port = ports["oa"], ports["ea"], ports["ra"], ports["sa"]
    if q_ea <= 0:
        ea_port[:] = False  # relief closed: its face is a wall, not a zero-flow opening
    X, Y, Z = grid.centers()
    v = {
        "oa": q_oa / (oa_port.sum() * A),
        "ea": q_ea / (ea_port.sum() * A) if ea_port.any() else 0.0,
        "ra": q_ra / (ra_port.sum() * A),
        "sa": SUPPLY / (sa_port.sum() * A),
    }

    # net OUTWARD boundary velocity per cell, and the boundary velocities along +x for reconstruction
    out[0][oa_port] -= v["oa"]
    out[0][ea_port] += v["ea"]
    out[-1][ra_port] -= v["ra"]
    out[-1][sa_port] += v["sa"]
    for region, c in carried.items():
        q_in = -float(out[lab == region].sum()) * A  # the region's net inflow leaves across the damper
        c["faces"] = F.add_links(out, links, c["pairs"], q_in, grid.h)
        c["q"] = round(q_in, 4)
    minus = np.zeros(grid.n[1:])
    minus[oa_port] = v["oa"]
    minus[ea_port] = -v["ea"]
    plus = np.zeros(grid.n[1:])
    plus[ra_port] = -v["ra"]
    plus[sa_port] = v["sa"]
    nx, ny, nz = grid.n
    zero_y = (np.zeros((nx, nz)), np.zeros((nx, nz)))
    zero_z = (np.zeros((nx, ny)), np.zeros((nx, ny)))
    F.assert_balanced(out, lab, grid.h, label=f"flow {p}")

    t0 = time.time()
    phi, iters, resid = F.solve_potential(faces, grid.h, out)
    F.assert_converged(resid, iters, label=f"flow {p}")
    vel = F.cell_velocity(phi, faces, grid.h, [(minus, plus), zero_y, zero_z], links=links)
    u, walls = F.face_velocities(phi, faces, grid.h, {"x-": (minus, oa_port | ea_port), "x+": (plus, ra_port | sa_port)},
                                 links=links)

    def flux(x, zlo, zhi):
        i = int((x - grid.lo[0]) / grid.h)
        k0 = int((zlo - grid.lo[2]) / grid.h)
        k1 = int((zhi - grid.lo[2]) / grid.h)
        return float(vel[i, :, k0:k1, 0].sum() * A)

    def leak(ax, coord, keep):
        """Gross flow (m³/s) through the face plane nearest `coord` on axis `ax`, over cells where keep() holds."""
        i = int(round((coord - grid.lo[ax]) / grid.h)) - 1
        uf = np.where(faces[ax], (np.roll(phi, -1, axis=ax) - phi) / grid.h, 0.0)
        sl = [slice(None)] * 3
        sl[ax] = i
        sl = tuple(sl)
        m = keep(X[sl], Y[sl], Z[sl])
        return round(float(np.abs(uf[sl][m]).sum() * A), 4)

    unit = lambda x, y, z: (x > -1.1) & (x < 1.38) & (np.abs(y) < 0.58)
    check = {
        # the unit's shell must only pass air where it's designed to: roof only at the RA damper,
        # end wall only at the supply opening
        "leak_roof": leak(2, 1.35, lambda x, y, z: unit(x, y, z) & ~((x > -0.97) & (x < -0.13) & (np.abs(y) < 0.47))),
        "leak_end": leak(0, 1.40, lambda x, y, z: (z > 0.17) & (z < 1.33) & (np.abs(y) < 0.58) & ~((np.abs(y) < 0.42) & (z > 0.33) & (z < 1.17))),
        "oa_through_damper": round(flux(-0.9, 0.15, 1.34), 3),
        "supply_duct": round(flux(2.3, 0.35, 1.15), 3),
        "return_duct": round(-flux(1.9, 1.36, 2.05), 3),
        "relief_out": round(-flux(-1.4, 1.37, 2.12), 3),
    }

    # emission boxes: OA over the damper face, RA over the return duct's open port cells
    emit = {"oa": EMIT_OA, "ra": F.port_box(Y[-1][ra_port], Z[-1][ra_port], grid.hi[0] - 0.1, grid.hi[0] - 0.01, grid.h)}
    live = [main, *carried]  # the regions that carry flow
    coverage = {s: round(F.emit_coverage(grid, lab, live, box), 4) for s, box in emit.items()}
    for s, c in coverage.items():
        if c < EMIT_COVERAGE_MIN:
            raise SystemExit(f"[flow] position {p}: only {c:.1%} of the {s} emission box {emit[s]} is in the airspace")

    # where does each inlet's air end up? trace seeds exactly the way the runtime moves particles
    rng = np.random.default_rng(7)
    fates = {}
    for stream, box in emit.items():
        seeds = rng.uniform(box["lo"], box["hi"], size=(400, 3))
        end, exited = F.trace(u, walls, grid.lo, grid.h, seeds)
        at_min = exited & (end[:, 0] < grid.lo[0] + grid.h)
        at_max = exited & (end[:, 0] > grid.hi[0] - grid.h)
        fates[stream] = {
            "supply": round(float((at_max & (end[:, 2] < 1.25)).mean()), 3),
            "relief": round(float((at_min & (end[:, 2] > SPLIT_Z)).mean()), 3),
            "backflow": round(float(((at_min & (end[:, 2] <= SPLIT_Z)) | (at_max & (end[:, 2] >= 1.25))).mean()), 3),
            "stuck": round(float((~exited).mean()), 3),
        }
    expect = {"oa_through_damper": q_oa, "supply_duct": SUPPLY, "return_duct": q_ra, "relief_out": q_ea}
    return {
        "pos": p,
        "u": u,
        "walls": walls,
        "emit": emit,
        "coverage": coverage,
        "fates": fates,
        "expect_fates": {"ra": {"relief": round(q_ea / q_ra, 3), "supply": round(q_ramix / q_ra, 3)}, "oa": {"supply": 1.0}},
        "flows": {"oa": q_oa, "raMix": q_ramix, "relief": q_ea, "return": q_ra, "supply": SUPPLY},
        "check": check,
        "expect": {k_: round(v_, 3) for k_, v_ in expect.items()},
        "iters": iters,
        "resid": resid,
        "secs": round(time.time() - t0, 1),
        "open_faces": round(float(sum(f_.mean() for f_ in faces) / 3), 3),
        "ports": {"oa": int(oa_port.sum()), "ea": int(ea_port.sum()), "ra": int(ra_port.sum()), "sa": int(sa_port.sum())},
        "damper_links": [{"openings": c["openings"], "faces": c["faces"], "q": c["q"]} for c in carried.values()],
    }


def main(positions=POSITIONS):
    scene = ensure_scene()
    grid = F.Grid(LO, HI, H)
    states, blobs, offset, report = [], [], 0, []
    emit = None
    for p in positions:
        s = bake_state(scene, grid, p)
        leaks = {k: v for k, v in s["check"].items() if k.startswith("leak_") and v > 0.01 * SUPPLY}
        if leaks:
            raise SystemExit(f"[flow] position {p}: air leaks through the unit shell {leaks} (m³/s). "
                             "Check that every panel seam is closed by an obstacle mesh.")
        if s["fates"]["oa"]["supply"] < OA_TO_SUPPLY_MIN:
            raise SystemExit(f"[flow] position {p}: only {s['fates']['oa']['supply']:.1%} of traced outside air reaches "
                             f"the supply duct {s['fates']['oa']}")
        drift = abs(s["fates"]["ra"]["relief"] - s["expect_fates"]["ra"]["relief"])
        if drift > RA_SPLIT_WARN:
            print(f"[flow] warning: position {p}: traced return split {s['fates']['ra']} vs model {s['expect_fates']['ra']}")
        if emit is None:
            emit = s["emit"]
        elif s["emit"] != emit:
            raise SystemExit(f"[flow] position {p}: emission boxes differ between states {s['emit']} vs {emit}")
        arrays, vmax, clipped = F.encode(s["u"], s["walls"])
        old, old_vmax = F.encode_peak(s["u"], s["walls"])  # the previous encoding, for the report
        jets = F.jet_cells(s["u"], vmax)
        s["div"] = {
            "float": F.divergence(s["u"], grid.h, jets),
            "int8": F.divergence(F.decode(arrays, vmax), grid.h, jets),
            "int8_vmax_at_peak": F.divergence(F.decode(old, old_vmax), grid.h, jets),
        }
        s["vmax"] = {"stored": round(vmax, 3), "peak": round(old_vmax, 3), "clipped_faces": round(clipped, 4)}
        entry = {"pos": p, "vmax": vmax, "flows": s["flows"]}
        for name, a in zip(("ux", "uy", "uz"), arrays):
            entry[name] = offset
            blobs.append(a.tobytes())
            offset += a.nbytes
        states.append(entry)
        report.append({k: s[k] for k in ("pos", "check", "expect", "fates", "expect_fates", "coverage", "iters", "resid",
                                          "secs", "open_faces", "ports", "damper_links", "vmax", "div")})
    os.makedirs(OUT_DIR, exist_ok=True)
    # pre-gzipped: the browser inflates it with DecompressionStream, whatever the server does
    with gzip.open(os.path.join(OUT_DIR, "flow.bin.gz"), "wb", compresslevel=9) as fh:
        for b in blobs:
            fh.write(b)
    stale = os.path.join(OUT_DIR, "flow.bin")
    if os.path.exists(stale):
        os.remove(stale)
    meta = {
        "version": 2,
        "axes": "blender",
        "layout": "staggered",
        "data": "flow.bin.gz",
        "note": "Potential-flow face velocities (m/s) for the economizer at several damper positions. Per state: "
        "ux (nx+1, ny, nz), uy (nx, ny+1, nz), uz (nx, ny, nz+1), each x fastest. int8, sqrt-companded: "
        "v = sign(q) * (q/127)^2 * vmax; -128 marks a wall face (no flow, particles collide). vmax is the 99.5th "
        "percentile of face speed (>= 5.5 m/s); the fan-inlet jet above it is clipped.",
        "lo": [float(v) for v in grid.lo],
        "h": grid.h,
        "n": list(grid.n),
        "supply": SUPPLY,
        "states": states,
        # where each stream's air enters, for particle emission (Blender coords)
        "emit": emit,
        # air takes each stage's temperature as it crosses its plane (here: fully mixed after the filter)
        "stages": [{"id": "mix", "x": 0.3}],
    }
    with open(os.path.join(OUT_DIR, "flow.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print("[flow] wrote", os.path.join(OUT_DIR, "flow.bin.gz"), offset, "bytes before gzip")
    for r in report:
        print("[flow]", json.dumps(r))
    return report


if __name__ == "__main__":
    main()
