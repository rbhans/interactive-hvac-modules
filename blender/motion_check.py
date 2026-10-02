"""Clearance check for moving parts: sweeps every ranged part (`rotate` about local X,
`translate` along local X) through its range, all driven together at output 0..1, re-aims
every `link` rod between its `from`/`to` pins the way the runtime does, and reports mesh
intersections between each moving part and its neighbours. Restores the rest pose.

In Blender: runpy.run_path(".../blender/motion_check.py", init_globals={"SCENE_NAME": "economizer"})
Result dict is left in the global RESULT.
"""
import math

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

SCENE = bpy.data.scenes[globals().get("SCENE_NAME", "economizer")]
STEPS = globals().get("STEPS", [0.0, 0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0])
# pairs of part names that are designed to touch / nest, per module
IGNORE = {
    "economizer": {
        # shaft through clamp, pin in clevis
        frozenset(("oa_blade_03", "oa_crank")), frozenset(("oa_blade_03", "oa_actuator")),
        frozenset(("oa_blade_03", "oa_actuator_hub")), frozenset(("oa_actuator", "oa_actuator_hub")),
        frozenset(("ea_blade_01", "ea_crank")), frozenset(("oa_crank", "link_rod_01")),
        frozenset(("ea_crank", "link_rod_01")),
    },
    "coils": {
        # the stem runs through the bonnet / packing nut and the actuator's base plate; the
        # position pointer is clamped to the stem coupling
        frozenset(("hw_valve_stem", "hw_valve")), frozenset(("hw_valve_stem", "hw_valve_actuator")),
        frozenset(("hw_valve_stem", "hw_valve_indicator")),
        frozenset(("chw_valve_stem", "chw_valve")), frozenset(("chw_valve_stem", "chw_valve_actuator")),
        frozenset(("chw_valve_stem", "chw_valve_indicator")),
    },
    "reset": {
        # each box's damper shaft runs through the inlet collar's bushings and into the actuator
        p for n in range(1, 5) for p in (frozenset(("vav%d_damper_blade" % n, "vav%d_inlet" % n)),
                                         frozenset(("vav%d_damper_blade" % n, "vav%d_controller" % n)))
    },
}.get(SCENE.name, set())
RANGED = ("rotate", "translate")


def _world(obj):
    """World matrix from the parent chain (no depsgraph needed, so it's never stale)."""
    if obj.parent is None:
        return obj.matrix_basis.copy()
    return _world(obj.parent) @ obj.matrix_parent_inverse @ obj.matrix_basis


def _tree(obj, dg, only_mat=None):
    oe = obj.evaluated_get(dg)
    me = oe.to_mesh()
    mw = _world(obj)
    verts = [mw @ v.co for v in me.vertices]
    mats = [s.material.name if s.material else "" for s in obj.material_slots]
    polys = [tuple(p.vertices) for p in me.polygons
             if only_mat is None or (p.material_index < len(mats) and mats[p.material_index] == only_mat)]
    oe.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys, all_triangles=False)


def _pose(o, rest, t):
    lo, hi = o["range"]
    v = lo + (hi - lo) * t
    if o["motion"] == "rotate":
        o.matrix_basis = rest @ Matrix.Rotation(math.radians(v), 4, "X")
    else:
        o.matrix_basis = rest @ Matrix.Translation((v, 0.0, 0.0))


def _aim(rod, rest, rest_len):
    """Re-aim a link rod from its `from` pin at its `to` pin and stretch its local X, as the
    runtime does (Equipment.tsx): minimal rotation from the authored direction."""
    frm, to = SCENE.objects[rod["from"]], SCENE.objects[rod["to"]]
    parent = _world(rod.parent) @ rod.matrix_parent_inverse if rod.parent else Matrix.Identity(4)
    inv = parent.inverted()
    a = inv @ _world(frm).translation
    b = inv @ _world(to).translation
    d = b - a
    if d.length < 1e-9:
        return
    loc, rot, scale = rest.decompose()
    authored = rot @ Vector((1.0, 0.0, 0.0))
    q = authored.rotation_difference(d.normalized()) @ rot
    s = Vector((scale.x * d.length / rest_len, scale.y, scale.z))
    rod.matrix_basis = Matrix.LocRotScale(a, q, s)


def run():
    dg = SCENE.view_layers[0].depsgraph
    dg.update()
    ranged = [o for o in SCENE.objects if o.type == "MESH" and o.get("motion") in RANGED]
    links = [o for o in SCENE.objects if o.type == "MESH" and o.get("motion") == "link"]
    movers = ranged + links
    statics = [o for o in SCENE.objects if o.type == "MESH" and not o.get("motion")]
    rest = {o.name: o.matrix_basis.copy() for o in movers}
    rest_len = {o.name: (_world(SCENE.objects[o["to"]]).translation - _world(SCENE.objects[o["from"]]).translation).length
                for o in links}
    report = {"movers": sorted(o.name for o in movers)}
    try:
        for t in STEPS:
            for o in ranged:
                _pose(o, rest[o.name], t)
            for o in links:
                _aim(o, rest[o.name], rest_len[o.name])
            SCENE.view_layers[0].update()
            dg.update()
            trees = {o.name: _tree(o, dg) for o in movers + statics}
            bodies = {o.name: _tree(o, dg, "mat_blade") for o in movers if "_blade_" in o.name}
            hits = []
            for i, a in enumerate(movers):
                for b in movers[i + 1:] + statics:
                    if frozenset((a.name, b.name)) in IGNORE:
                        continue
                    ta = trees[a.name]
                    if b.name.endswith("_frame") and a.name.startswith(b.name[:-6] + "_blade"):
                        # the shaft passes through its own jamb by design: test the blade body only
                        ta = bodies[a.name]
                    n = len(ta.overlap(trees[b.name]))
                    if n:
                        hits.append("%s x %s (%d)" % (a.name, b.name, n))
            report["%.2f" % t] = hits
    finally:
        for o in movers:
            o.matrix_basis = rest[o.name]
        SCENE.view_layers[0].update()
    return report


RESULT = run()
