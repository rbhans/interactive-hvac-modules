"""Flow-path clearance check: rebuilds each flow_<stream>_NN chain as a
centripetal Catmull-Rom curve (like three.js CatmullRomCurve3), offsets it to
the four corners of its interpolated `spread` envelope (+/- across in world Y,
+/- normal in the path plane) and ray-casts every segment against static solids
(walls, frames, motor...). Parts air is meant to pass through (filter media,
sensor element, damper blades, fan wheel) are ignored.

In Blender: runpy.run_path(".../blender/flow_check.py") -> RESULT dict {stream: [hits]}
"""
import math

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

SCENE = bpy.data.scenes[globals().get("SCENE_NAME", "economizer")]
SAMPLES_PER_SEG = globals().get("SAMPLES_PER_SEG", 24)
# Name fragments of parts a flow path may pass through, per module
PASS_THROUGH = {
    # filter media, sensor element, damper blades, fan wheel, linkage
    "economizer": ("filter_media", "mat_sensor", "fan_wheel", "_blade_", "link_rod", "_crank"),
    # air: filter media, coil fin packs, DAT sensor element, fan wheel.
    # water: the flow chains run on pipe centrelines, so they cross the insulation's end caps
    # (`_supply_pipe` / `_return_pipe`) at every fitting, the inline fittings themselves (ball,
    # balancing and control valves with their bare nipples), the coil-side flanges and nipples
    # (`_fittings`), the connection stubs on the coil headers, the roof curbs and the thermometer wells.
    "coils": ("filter_media", "_coil_fins", "dat_sensor", "fan_wheel",
              "_supply_pipe", "_return_pipe", "_coil_headers",
              "_valve", "_fittings", "_curb", "_thermometer_"),
}.get(SCENE.name, ("filter_media", "fan_wheel"))


def _cr_point(p0, p1, p2, p3, t):
    # centripetal Catmull-Rom (alpha = 0.5), as three.js CatmullRomCurve3
    def dt(a, b):
        d = (b - a).length_squared ** 0.25
        return d
    d0, d1, d2 = dt(p0, p1), dt(p1, p2), dt(p2, p3)
    if d1 < 1e-4:
        d1 = 1.0
    if d0 < 1e-4:
        d0 = d1
    if d2 < 1e-4:
        d2 = d1
    out = Vector()
    for k in range(3):
        x0, x1, x2, x3 = p0[k], p1[k], p2[k], p3[k]
        t1 = ((x1 - x0) / d0 - (x2 - x0) / (d0 + d1) + (x2 - x1) / d1) * d1
        t2 = ((x2 - x1) / d1 - (x3 - x1) / (d1 + d2) + (x3 - x2) / d2) * d1
        c0, c1 = x1, t1
        c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2
        c3 = 2 * x1 - 2 * x2 + t1 + t2
        out[k] = c0 + c1 * t + c2 * t * t + c3 * t * t * t
    return out


def _curve(points):
    n = len(points)
    pts = []
    for i in range(n - 1):
        p0 = points[i - 1] if i > 0 else points[0] * 2 - points[1]
        p3 = points[i + 2] if i + 2 < n else points[-1] * 2 - points[-2]
        for s in range(SAMPLES_PER_SEG):
            t = s / SAMPLES_PER_SEG
            pts.append((i + t, _cr_point(p0, points[i], points[i + 1], p3, t)))
    pts.append((n - 1, points[-1].copy()))
    return pts


def _obstacles(dg):
    verts, polys, owner = [], [], []
    for o in SCENE.objects:
        if o.type != "MESH" or any(k in o.name for k in PASS_THROUGH):
            continue
        oe = o.evaluated_get(dg)
        me = oe.to_mesh()
        base = len(verts)
        mw = oe.matrix_world  # evaluated: right even when this scene isn't the window's
        verts.extend(mw @ v.co for v in me.vertices)
        for p in me.polygons:
            polys.append(tuple(base + v for v in p.vertices))
            owner.append(o.name)
        oe.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys), owner


def run():
    dg = SCENE.view_layers[0].depsgraph
    tree, owner = _obstacles(dg)
    streams = {}
    for o in SCENE.objects:
        if o.name.startswith("flow_"):
            s, idx = o.name[5:].rsplit("_", 1)
            streams.setdefault(s, []).append((int(idx), o))
    report = {}
    for s, items in sorted(streams.items()):
        items.sort()
        pts = [o.matrix_world.translation.copy() for _, o in items]
        spreads = [tuple(o.get("spread", (0.0, 0.0))) for _, o in items]
        curve = _curve(pts)
        hits = []
        offsets = [(0, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)]
        for sa, sb in offsets:
            prev = None
            for k, (u, p) in enumerate(curve):
                i = min(int(u), len(spreads) - 2)
                f = u - i
                a = spreads[i][0] * (1 - f) + spreads[i + 1][0] * f
                b = spreads[i][1] * (1 - f) + spreads[i + 1][1] * f
                nxt = curve[min(k + 1, len(curve) - 1)][1]
                prv = curve[max(k - 1, 0)][1]
                tan = (nxt - prv).normalized()
                nrm = Vector((0, 1, 0)).cross(tan).normalized()
                q = p + Vector((0, 1, 0)) * a * sa + nrm * b * sb
                if prev is not None:
                    d = q - prev
                    L = d.length
                    if L > 1e-9:
                        loc, n, fi, dist = tree.ray_cast(prev, d / L, L)
                        if loc is not None:
                            hits.append("offset(%+d,%+d) u=%.2f hits %s at (%.2f, %.2f, %.2f)" % (
                                sa, sb, u, owner[fi], loc.x, loc.y, loc.z))
                prev = q
        report[s] = hits
    return report


RESULT = run()
