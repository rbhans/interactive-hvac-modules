"""Site context for a diorama: a roof-deck section and a penthouse wall.
Both are cut like an architectural section, so the layers show on the edges.
All pieces are static; origins sit at the piece center with identity rotation."""
from mathutils import Matrix, Vector

import hvaclab as H


def deck(scene, name, x0, x1, y0, y1, layers, top=0.0, parent=None, bevel=0.004):
    """Layered slab whose top surface is at z = top. layers: [(thickness, mat), ...] top-down."""
    mb = H.MeshBuilder()
    z = top
    for t, mat in layers:
        mb.box((x0, y0, z - t), (x1, y1, z), mat)
        z -= t
    ctr = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (top + z) / 2))
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world", bevel=bevel)


def _spans(lo, hi, cuts):
    """Complement of `cuts` (sorted, non-overlapping (a, b) intervals) within lo..hi."""
    out, cur = [], lo
    for a, b in sorted(cuts):
        if a > cur:
            out.append((cur, a))
        cur = max(cur, b)
    if cur < hi:
        out.append((cur, hi))
    return out


def wall(scene, name, x0, y0, y1, z0, z1, layers, openings=(), liner="mat_liner", cap=None,
         parent=None, bevel=0.004):
    """Wall in the YZ plane, built outward from its face at x = x0 in +X.
    layers: [(thickness, mat), ...] from the face inward.
    openings: [(ya, yb, za, zb), ...] rectangular penetrations through every layer.
    Each opening is sleeved in `liner` and capped at the back, so it reads as a
    duct running into the building rather than a hole. cap = (height, mat) adds a coping."""
    mb = H.MeshBuilder()
    zs = sorted({z0, z1, *[v for o in openings for v in (o[2], o[3])]})
    x = x0
    for t, mat in layers:
        for za, zb in zip(zs, zs[1:]):
            cuts = [(o[0], o[1]) for o in openings if o[2] <= za and o[3] >= zb]
            for ya, yb in _spans(y0, y1, cuts):
                mb.box((x, ya, za), (x + t, yb, zb), mat)
        x += t
    x1 = x
    s = 0.012
    for ya, yb, za, zb in openings:
        mb.box((x0, ya, za), (x1 - s, ya + s, zb), liner, bw=0.2)
        mb.box((x0, yb - s, za), (x1 - s, yb, zb), liner, bw=0.2)
        mb.box((x0, ya + s, za), (x1 - s, yb - s, za + s), liner, bw=0.2)
        mb.box((x0, ya + s, zb - s), (x1 - s, yb - s, zb), liner, bw=0.2)
        mb.box((x1 - s, ya, za), (x1, yb, zb), liner, bw=0.2)
    if cap:
        h, mat = cap
        mb.box((x0 - 0.02, y0 - 0.02, z1), (x1 + 0.02, y1 + 0.02, z1 + h), mat)
    ctr = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world", bevel=bevel)


def pavers(scene, name, centers, w, d, t=0.035, mat="mat_concrete", parent=None, bevel=0.006):
    """Walkway pads on the deck (service access), centered at (x, y), top at z = t."""
    mb = H.MeshBuilder()
    for cx, cy in centers:
        mb.box((cx - w / 2, cy - d / 2, 0.0), (cx + w / 2, cy + d / 2, t), mat)
    cx = sum(c[0] for c in centers) / len(centers)
    cy = sum(c[1] for c in centers) / len(centers)
    return mb.to_object(scene, name, matrix=Matrix.Translation(Vector((cx, cy, t / 2))), parent=parent,
                        space="world", bevel=bevel)
