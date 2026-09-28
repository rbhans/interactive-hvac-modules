"""Z-fighting check: finds coplanar, same-facing faces (evaluated meshes, world
space) whose areas overlap. Faces are bucketed by plane, then convex polygon
clipping measures the shared area.

In Blender: runpy.run_path(".../blender/zfight_check.py") -> RESULT list
"""
import math
from collections import defaultdict

import bpy
from mathutils import Vector

SCENE = bpy.data.scenes[globals().get("SCENE_NAME", "economizer")]
PLANE_EPS = 2e-4     # m
MIN_AREA = 2e-6      # m^2 (2 mm^2)


def _clip(subject, clip):
    """Sutherland-Hodgman: convex polygon intersection in 2D."""
    def inside(p, a, b):
        return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-12

    def inter(p, q, a, b):
        x1, y1, x2, y2 = p[0], p[1], q[0], q[1]
        x3, y3, x4, y4 = a[0], a[1], b[0], b[1]
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if abs(den) < 1e-18:
            return q
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

    out = subject
    for i in range(len(clip)):
        a, b = clip[i], clip[(i + 1) % len(clip)]
        inp, out = out, []
        if not inp:
            break
        s = inp[-1]
        for e in inp:
            if inside(e, a, b):
                if not inside(s, a, b):
                    out.append(inter(s, e, a, b))
                out.append(e)
            elif inside(s, a, b):
                out.append(inter(s, e, a, b))
            s = e
    return out


def _area(poly):
    a = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        a += x0 * y1 - x1 * y0
    return a * 0.5


def run():
    dg = SCENE.view_layers[0].depsgraph
    buckets = defaultdict(list)
    for o in SCENE.objects:
        if o.type != "MESH":
            continue
        oe = o.evaluated_get(dg)
        me = oe.to_mesh()
        mw = o.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        me.calc_loop_triangles()
        for tri in me.loop_triangles:
            n = (nm @ tri.normal).normalized()
            pts = [mw @ me.vertices[v].co for v in tri.vertices]
            d = n.dot(pts[0])
            key = (round(n.x, 3), round(n.y, 3), round(n.z, 3), round(d / PLANE_EPS))
            buckets[key].append((o.name, n, pts))
        oe.to_mesh_clear()
    hits = defaultdict(float)
    for key, faces in buckets.items():
        if len(faces) < 2:
            continue
        n = faces[0][1]
        u = n.orthogonal().normalized()
        v = n.cross(u)
        proj = []
        for name, _, pts in faces:
            poly = [(p.dot(u), p.dot(v)) for p in pts]
            if _area(poly) < 0:
                poly.reverse()
            xs, ys = [p[0] for p in poly], [p[1] for p in poly]
            proj.append((name, poly, (min(xs), max(xs), min(ys), max(ys))))
        for i in range(len(proj)):
            ni, pi, bi = proj[i]
            for j in range(i + 1, len(proj)):
                nj, pj, bj = proj[j]
                if bi[1] <= bj[0] or bj[1] <= bi[0] or bi[3] <= bj[2] or bj[3] <= bi[2]:
                    continue
                inter = _clip(pi, pj)
                if len(inter) >= 3:
                    a = abs(_area(inter))
                    if a > MIN_AREA:
                        hits[tuple(sorted((ni, nj)))] += a
    return sorted(("%s | %s" % k, round(a * 1e4, 2)) for k, a in hits.items())   # cm^2


RESULT = run()
