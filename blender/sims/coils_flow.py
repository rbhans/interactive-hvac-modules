"""Bake the coil section's airflow field.

One state: nothing in this section moves the air around (the valves only change water flow), so
the field is solved once. Air enters over the whole section cut at x-min, passes the filter and
both coils, funnels into the fan inlet, and leaves through the supply duct into the building.
The fin packs and filter media are porous, so they're not obstacles; the coil casings,
headers and drain pan are.

In Blender:  runpy.run_path(".../blender/sims/coils_flow.py", run_name="__main__")
Headless:    blender -b --factory-startup -P blender/sims/coils_flow.py
"""
import gzip
import json
import os
import re
import sys
import time

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import flowsolve as F  # noqa: E402

OUT_DIR = os.path.join(ROOT, "public", "lab", "coils")

# ── domain (Blender Z-up, meters) ────────────────────────────────────────────
H = 0.04
# x starts exactly at the section cut; y spans exactly the unit's width
LO = (-2.20, -0.60, 0.12)
HI = (2.60, 0.60, 1.40)
SUPPLY = 1.18  # m³/s (2500 cfm); only the shape of the field matters, the runtime rescales speed

# Parts air passes through or around without being steered: porous media, the fan wheel,
# the thin sensor element, the coil internals (tubes pass through the fin pack), and
# everything outside the airstream.
EXCLUDE = re.compile(
    r"^(filter_media|fan_wheel|dat_sensor|dat_sensor_head|(hw|chw)_coil_(fins|tubes)|"
    r"base_rail_\d+|site_.*|(hw|chw)_(supply|return)_pipe|.*_valve.*|.*_thermometer_\d+|chw_trap|chw_drain.*)$"
)
# the drain pan sits in the airstream under the cooling coil: keep it
KEEP = re.compile(r"^chw_drain_pan$")

# supply duct outlet (the economizer's section, same unit)
SA = {"z": (0.35, 1.15), "y": 0.40}


def ensure_scene():
    """The coils scene, built fresh if this Blender session doesn't have it (headless).
    Builds geometry only; it never re-exports the GLB. Either way the scene must pass the
    build's self-check: in a live session another module's scene can already own names like
    `filter_media`, and Blender then names ours `filter_media.001`, which EXCLUDE would
    silently turn into a solid obstacle."""
    for p in (os.path.join(ROOT, "blender", "lib"), os.path.join(ROOT, "blender")):
        if p not in sys.path:
            sys.path.insert(0, p)
    import hvaclab as HL

    sc = bpy.data.scenes.get("coils")
    if not (sc and len(sc.objects) > 20):
        import runpy

        mod = runpy.run_path(os.path.join(ROOT, "blender", "modules", "coils.py"), run_name="hvac_module_coils")
        sc = HL.reset_scene("coils")
        HL.activate_scene(sc)
        mod["build"](sc)
    errors = HL.self_check(sc)
    if errors:
        renamed = sorted(o.name for o in sc.objects if re.search(r"\.\d{3}$", o.name))
        hint = ""
        if renamed:
            hint = (f"\n  {len(renamed)} objects carry Blender's .NNN suffix (e.g. {', '.join(renamed[:4])}): another scene "
                    "in this session already uses those names. Bake headless (npm run assets:flow -- coils) or remove "
                    "the other module's scene first.")
        raise SystemExit("[flow] scene 'coils' fails the build self-check:\n  " + "\n  ".join(errors[:20]) + hint)
    return sc


def scene_depsgraph(scene):
    """The scene's own evaluated depsgraph; bpy.context's may belong to another scene (headless)."""
    dg = scene.view_layers[0].depsgraph
    dg.update()
    return dg


def world_bbox(scene, dg, name):
    ob = scene.objects[name].evaluated_get(dg)
    me = ob.to_mesh()
    pts = np.array([tuple(ob.matrix_world @ v.co) for v in me.vertices])
    ob.to_mesh_clear()
    return pts.min(axis=0), pts.max(axis=0)


def bake(scene, grid):
    dg = scene_depsgraph(scene)
    obstacles = [o for o in scene.objects if o.type == "MESH" and (KEEP.match(o.name) or not EXCLUDE.match(o.name))]
    bvh = F.bvh_from_objects(obstacles, dg)
    faces = F.open_faces(grid, bvh)

    X, Y, Z = grid.centers()
    z0, y0 = Z[0], Y[0]
    zN, yN = Z[-1], Y[-1]
    in_port = (z0 > 0.15) & (z0 < 1.35)
    sa_port = (zN > SA["z"][0]) & (zN < SA["z"][1]) & (np.abs(yN) < SA["y"])

    lab = F.components(faces)
    if not sa_port.any():
        raise SystemExit("[flow] no supply port cells")
    main = int(np.bincount(lab[-1][sa_port]).argmax())
    in_port &= lab[0] == main
    sa_port &= lab[-1] == main
    if not in_port.any():
        raise SystemExit("[flow] the section cut is sealed from the supply outlet")

    A = grid.h * grid.h
    v_in = SUPPLY / (in_port.sum() * A)
    v_sa = SUPPLY / (sa_port.sum() * A)
    ny, nz = grid.n[1], grid.n[2]
    out = np.zeros(grid.n)
    out[0][in_port] -= v_in
    out[-1][sa_port] += v_sa
    minus = np.zeros((ny, nz))
    minus[in_port] = v_in
    plus = np.zeros((ny, nz))
    plus[sa_port] = v_sa
    F.assert_balanced(out, lab, grid.h, label="flow coils")

    t0 = time.time()
    phi, iters, resid = F.solve_potential(faces, grid.h, out)
    F.assert_converged(resid, iters, label="flow coils")
    u, walls = F.face_velocities(phi, faces, grid.h, {"x-": (minus, in_port), "x+": (plus, sa_port)})

    # the potential's face velocities along x, for flux checks through planes
    ux = np.where(faces[0], (np.roll(phi, -1, axis=0) - phi) / grid.h, 0.0)

    def plane(x):
        return int(round((x - grid.lo[0]) / grid.h)) - 1

    def through(x, keep=None):
        i = plane(x)
        m = np.ones((ny, nz), dtype=bool) if keep is None else keep(Y[i], Z[i])
        return float(ux[i][m].sum() * A)

    # coils: what share of the air goes through the fin pack rather than around it
    coils = {}
    for c in ("hw", "chw"):
        lo, hi = world_bbox(scene, dg, f"{c}_coil_fins")
        mid = (lo[0] + hi[0]) / 2
        # cells whose centre is within half a cell of the fin pack overlap it
        e = grid.h / 2
        face = lambda y, z, lo=lo, hi=hi: (y > lo[1] - e) & (y < hi[1] + e) & (z > lo[2] - e) & (z < hi[2] + e)
        total = through(mid)
        fins = through(mid, face)
        i = plane(mid)
        vf = ux[i][face(Y[i], Z[i]) & faces[0][i]]
        coils[c] = {
            "x": [round(float(lo[0]), 3), round(float(hi[0]), 3)],
            "stage_x": round(float(mid), 3),
            "through_fins": round(fins / total, 3) if total else 0.0,
            # face-velocity spread across the fin pack: max/mean
            "face_peak": round(float(vf.max() / vf.mean()), 2) if vf.size else 0.0,
        }

    # emit over the cut's open cells (not into the housing panels)
    emit = {"air": F.port_box(Y[0][in_port], Z[0][in_port], grid.lo[0] + 0.01, grid.lo[0] + 0.12, grid.h)}
    coverage = round(F.emit_coverage(grid, lab, main, emit["air"]), 4)
    if coverage < 0.99:
        raise SystemExit(f"[flow] only {coverage:.1%} of the emission box {emit['air']} is in the airspace")

    # where does the air end up? trace seeds exactly the way the runtime moves particles
    rng = np.random.default_rng(7)
    seeds = rng.uniform(emit["air"]["lo"], emit["air"]["hi"], size=(600, 3))
    end, exited = F.trace(u, walls, grid.lo, grid.h, seeds)
    at_max = exited & (end[:, 0] > grid.hi[0] - grid.h)
    fates = {
        "supply": round(float(at_max.mean()), 3),
        "backflow": round(float((exited & ~at_max).mean()), 3),
        "stuck": round(float((~exited).mean()), 3),
    }
    return {
        "u": u,
        "walls": walls,
        "emit": emit,
        "coverage": coverage,
        "coils": coils,
        "fates": fates,
        "check": {"supply_duct": round(through(2.3, lambda y, z: (z > 0.35) & (z < 1.15)), 3), "filter": round(through(-1.3), 3)},
        "iters": iters,
        "resid": resid,
        "secs": round(time.time() - t0, 1),
        "open_faces": round(float(sum(f.mean() for f in faces) / 3), 3),
    }


def main():
    scene = ensure_scene()
    grid = F.Grid(LO, HI, H)
    s = bake(scene, grid)
    for c, r in s["coils"].items():
        if r["through_fins"] < 0.97:
            raise SystemExit(f"[flow] {c} coil: only {r['through_fins']:.1%} of the air goes through the fins {r}. "
                             "Close the gap between the coil casing and the housing.")
    if s["fates"]["supply"] < 0.98:
        raise SystemExit(f"[flow] only {s['fates']['supply']:.1%} of traced air reaches the supply duct {s['fates']}")

    arrays, vmax, clipped = F.encode(s["u"], s["walls"])
    old, old_vmax = F.encode_peak(s["u"], s["walls"])  # the previous encoding, for the report
    jets = F.jet_cells(s["u"], vmax)
    s["div"] = {
        "float": F.divergence(s["u"], grid.h, jets),
        "int8": F.divergence(F.decode(arrays, vmax), grid.h, jets),
        "int8_vmax_at_peak": F.divergence(F.decode(old, old_vmax), grid.h, jets),
    }
    s["vmax"] = {"stored": round(vmax, 3), "peak": round(old_vmax, 3), "clipped_faces": round(clipped, 4)}
    blobs, offset = [], 0
    entry = {"pos": 0, "vmax": vmax, "flows": {"supply": SUPPLY}}
    for name, a in zip(("ux", "uy", "uz"), arrays):
        entry[name] = offset
        blobs.append(a.tobytes())
        offset += a.nbytes

    os.makedirs(OUT_DIR, exist_ok=True)
    with gzip.open(os.path.join(OUT_DIR, "flow.bin.gz"), "wb", compresslevel=9) as fh:
        for b in blobs:
            fh.write(b)
    meta = {
        "version": 2,
        "axes": "blender",
        "layout": "staggered",
        "data": "flow.bin.gz",
        "note": "Potential-flow face velocities (m/s) through the coil section. One state. "
        "ux (nx+1, ny, nz), uy (nx, ny+1, nz), uz (nx, ny, nz+1), each x fastest. int8, sqrt-companded: "
        "v = sign(q) * (q/127)^2 * vmax; -128 marks a wall face (no flow, particles collide). vmax is the 99.5th "
        "percentile of face speed (>= 5.5 m/s); the fan-inlet jet above it is clipped.",
        "lo": [float(v) for v in grid.lo],
        "h": grid.h,
        "n": list(grid.n),
        "supply": SUPPLY,
        "states": [entry],
        "emit": s["emit"],
        # air takes each coil's leaving temperature as it crosses the middle of its fin pack
        "stages": [{"id": c, "x": s["coils"][c]["stage_x"]} for c in ("hw", "chw")],
    }
    with open(os.path.join(OUT_DIR, "flow.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print("[flow] wrote", os.path.join(OUT_DIR, "flow.bin.gz"), offset, "bytes before gzip")
    print("[flow]", json.dumps({k: s[k] for k in ("coils", "fates", "check", "emit", "coverage", "iters", "resid", "secs",
                                                   "open_faces", "vmax", "div")}))
    return s


if __name__ == "__main__":
    main()
