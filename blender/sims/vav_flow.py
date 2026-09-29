"""Bake the VAV box's airflow fields.

For a handful of damper positions: pose the butterfly blade, voxelize the branch duct, box, discharge
duct and flex drops, prescribe design airflow in at the branch and out through the two diffuser
necks, solve, and write public/lab/vav/flow.{json,bin.gz}. The runtime scales the velocities by the
box's actual airflow (FieldBinding.speed), so one design-flow solve per position is enough.

The room below and the supply main are drawn with path streams, not solved here.

In Blender:  runpy.run_path(".../blender/sims/vav_flow.py", run_name="__main__")
Headless:    blender -b --factory-startup -P blender/sims/vav_flow.py
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

OUT_DIR = os.path.join(ROOT, "public", "lab", "vav")

# ── geometry (Blender Z-up, meters): see blender/modules/vav.py ─────────────
BRANCH = {"y": 0.0, "z": 3.2, "r": 0.125}  # round branch/inlet, axis along +X
NECKS = [(0.7, 0.0), (1.9, 0.0)]  # diffuser neck centers (x, y)
NECK_R = 0.1

# ── domain ───────────────────────────────────────────────────────────────────
H = 0.025
# x starts just inside the branch past the main's wall; z starts inside the diffuser necks, above the louvers
LO = (-1.40, -0.325, 2.76)
HI = (2.25, 0.325, 3.46)
SUPPLY = 1000 * 0.000471947  # design 1000 cfm in m³/s; the runtime rescales to the actual airflow

POSITIONS = [0.15, 0.3, 0.5, 0.75, 1.0]

# thin or porous parts air passes through or around without being steered, and everything outside the ducts
EXCLUDE = re.compile(r"^(vav_flow_cross|vav_sense_tubes|vav_controller|vav_actuator_hub|vav_hangers|hangers|hanger.*|site_.*|room_.*|desk|monitor|chair|tstat|return_grille|supply_main.*|static_tap.*|neighbor_takeoff.*)$")


def ensure_scene():
    sc = bpy.data.scenes.get("vav")
    if sc and len(sc.objects) > 20:
        return sc
    import runpy

    for p in (os.path.join(ROOT, "blender", "lib"), os.path.join(ROOT, "blender")):
        if p not in sys.path:
            sys.path.insert(0, p)
    import hvaclab as HL

    mod = runpy.run_path(os.path.join(ROOT, "blender", "modules", "vav.py"), run_name="hvac_module_vav")
    scene = HL.reset_scene("vav")
    HL.activate_scene(scene)
    mod["build"](scene)
    return scene


def scene_depsgraph(scene):
    dg = scene.view_layers[0].depsgraph
    dg.update()
    return dg


def pose(scene, p):
    """Turn the blade about its local X (post-multiplied, so parents don't matter). Returns the originals."""
    saved = {}
    for o in scene.objects:
        if o.name == "vav_damper_blade":
            saved[o.name] = o.matrix_basis.copy()
            r = o["range"]
            o.matrix_basis = o.matrix_basis @ Matrix.Rotation(math.radians(r[1] * p), 4, "X")
    if not saved:
        raise SystemExit("[flow] no vav_damper_blade in the scene")
    return saved


def bake_state(scene, grid, p):
    saved = pose(scene, p)
    dg = scene_depsgraph(scene)
    obstacles = [o for o in scene.objects if o.type == "MESH" and not EXCLUDE.match(o.name)]
    bvh = F.bvh_from_objects(obstacles, dg)
    for name, basis in saved.items():
        scene.objects[name].matrix_basis = basis
    scene_depsgraph(scene)

    faces = F.open_faces(grid, bvh)
    X, Y, Z = grid.centers()
    nx, ny, nz = grid.n
    # inlet: the branch's round section on the x-min face; outlets: the necks' round sections on z-min
    in_port = np.hypot(Y[0] - BRANCH["y"], Z[0] - BRANCH["z"]) < BRANCH["r"] - 0.004
    Xb, Yb = X[:, :, 0], Y[:, :, 0]
    out_port = np.zeros((nx, ny), dtype=bool)
    for cx, cy in NECKS:
        out_port |= np.hypot(Xb - cx, Yb - cy) < NECK_R - 0.004

    lab = F.components(faces)
    main = int(np.bincount(lab[0][in_port]).argmax())
    in_port &= lab[0] == main
    out_port &= lab[:, :, 0] == main
    if not in_port.any() or not out_port.any():
        raise SystemExit(f"[flow] position {p}: inlet {in_port.sum()} / outlet {out_port.sum()} cells connected; the ducts are sealed somewhere")

    A = grid.h * grid.h
    v_in = SUPPLY / (in_port.sum() * A)
    v_out = SUPPLY / (out_port.sum() * A)
    out = np.zeros(grid.n)
    out[0][in_port] -= v_in
    out[:, :, 0][out_port] += v_out
    minus_x = np.zeros((ny, nz))
    minus_x[in_port] = v_in
    minus_z = np.zeros((nx, ny))
    minus_z[out_port] = -v_out  # flow leaves downward: negative z velocity on the z-min face

    F.assert_balanced(out, lab, grid.h, label=f"flow vav {p}")
    t0 = time.time()
    phi, iters, resid = F.solve_potential(faces, grid.h, out)
    F.assert_converged(resid, iters, label=f"flow vav {p}")
    u, walls = F.face_velocities(phi, faces, grid.h, {"x-": (minus_x, in_port), "z-": (minus_z, out_port)})

    # the smaller flux checks: all of it out through the necks, and how it splits between them
    uz = np.where(faces[2], (np.roll(phi, -1, axis=2) - phi) / grid.h, 0.0)
    split = []
    for cx, cy in NECKS:
        m = np.hypot(X[:, :, 1] - cx, Y[:, :, 1] - cy) < NECK_R + 0.02
        split.append(round(float(-uz[:, :, 1][m].sum() * A) / SUPPLY, 3))

    # the inscribed square of the round inlet: every seed lands in moving air
    s = (BRANCH["r"] - 0.01) / math.sqrt(2)
    emit = {"air": {"lo": [round(grid.lo[0] + 0.01, 3), round(BRANCH["y"] - s, 3), round(BRANCH["z"] - s, 3)],
                    "hi": [round(grid.lo[0] + 0.05, 3), round(BRANCH["y"] + s, 3), round(BRANCH["z"] + s, 3)]}}

    rng = np.random.default_rng(7)
    seeds = rng.uniform(emit["air"]["lo"], emit["air"]["hi"], size=(400, 3))
    end, exited = F.trace(u, walls, grid.lo, grid.h, seeds)
    down = exited & (end[:, 2] < grid.lo[2] + grid.h)
    fates = {"room": round(float(down.mean()), 3), "back": round(float((exited & ~down).mean()), 3), "stuck": round(float((~exited).mean()), 3)}
    return {"pos": p, "u": u, "walls": walls, "emit": emit, "fates": fates, "split": split, "iters": iters, "resid": resid,
            "secs": round(time.time() - t0, 1), "cells": {"in": int(in_port.sum()), "out": int(out_port.sum())}}


def main(positions=POSITIONS):
    scene = ensure_scene()
    grid = F.Grid(LO, HI, H)
    states, blobs, offset, report, emit = [], [], 0, [], None
    for p in positions:
        s = bake_state(scene, grid, p)
        if s["fates"]["room"] < 0.97:
            raise SystemExit(f"[flow] position {p}: only {s['fates']['room']:.1%} of traced air reaches the diffusers {s['fates']}")
        arrays, vmax, clipped = F.encode(s["u"], s["walls"])
        s["clipped"] = round(clipped, 4)
        entry = {"pos": p, "vmax": vmax, "flows": {"supply": SUPPLY}}
        for name, a in zip(("ux", "uy", "uz"), arrays):
            entry[name] = offset
            blobs.append(a.tobytes())
            offset += a.nbytes
        states.append(entry)
        emit = s["emit"]
        report.append({k: s[k] for k in ("pos", "fates", "split", "iters", "resid", "secs", "cells", "clipped")})
    os.makedirs(OUT_DIR, exist_ok=True)
    with gzip.open(os.path.join(OUT_DIR, "flow.bin.gz"), "wb", compresslevel=9) as fh:
        for b in blobs:
            fh.write(b)
    meta = {
        "version": 2,
        "axes": "blender",
        "layout": "staggered",
        "data": "flow.bin.gz",
        "note": "Potential-flow face velocities (m/s) through the VAV branch, box, discharge and drops at design airflow, "
        "at several damper positions. Per state: ux (nx+1, ny, nz), uy (nx, ny+1, nz), uz (nx, ny, nz+1), each x fastest. "
        "int8, sqrt-companded: v = sign(q) * (q/127)^2 * vmax; -128 marks a wall face.",
        "lo": list(grid.lo),
        "h": grid.h,
        "n": list(grid.n),
        "supply": SUPPLY,
        "states": states,
        "emit": emit,
        "stages": [],
    }
    with open(os.path.join(OUT_DIR, "flow.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print("[flow] wrote", os.path.join(OUT_DIR, "flow.bin.gz"), offset, "bytes before gzip")
    for r in report:
        print("[flow]", json.dumps(r))
    return report


if __name__ == "__main__":
    main()
