"""Housing shells: panels (with holes), edge framing, duct stubs, flanges and
base rails. All pieces are static; origins sit at the piece center with
identity rotation."""
from mathutils import Matrix, Vector

import hvaclab as H


def _thin_axis(lo, hi):
    ext = [hi[i] - lo[i] for i in range(3)]
    return min(range(3), key=lambda i: ext[i])


def panel(scene, name, lo, hi, mat="mat_housing", hole=None, parent=None, bevel=0.004, inner=None):
    """Axis-aligned panel between world corners lo/hi. The thinnest axis is the
    thickness. hole (world coords, in the panel's (u, v) = the next two axes
    cyclically after the thin one): ('rect', u0, u1, v0, v1) or
    ('circle', cu, cv, r, seg). inner: a world point inside the enclosure (or
    "both"); the face(s) looking at it get the dark liner."""
    lo, hi = Vector(lo), Vector(hi)
    t = _thin_axis(lo, hi)
    u, v = (t + 1) % 3, (t + 2) % 3
    ctr = (lo + hi) / 2
    ax = [Vector([1 if j == i else 0 for j in range(3)]) for i in range(3)]
    xf = H.basis(ax[u], ax[v], ax[t], ctr)
    outer = (lo[u] - ctr[u], hi[u] - ctr[u], lo[v] - ctr[v], hi[v] - ctr[v])
    loc_hole = None
    if hole is not None:
        if hole[0] == "rect":
            _, a0, a1, b0, b1 = hole
            loc_hole = ("rect", a0 - ctr[u], a1 - ctr[u], b0 - ctr[v], b1 - ctr[v])
        else:
            _, cu, cv, r, seg = hole
            loc_hole = ("circle", cu - ctr[u], cv - ctr[v], r, seg)
    mb = H.MeshBuilder()
    mb.plate(outer, hi[t] - lo[t], mat, xf, hole=loc_hole)
    if inner is not None:
        mb.line_interior(t, inner)
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world", bevel=bevel)


def edge_frame(scene, name, lo, hi, size=0.035, open_min_x=True, x_start=None, parent=None, bevel=0.004):
    """Square-bar framing on the edges of box lo..hi. Long (X) bars run from
    x_start to the +X end frame; the +X end gets a full rectangular frame. The
    -X end is left open (a damper frame closes it). Bars abut, never overlap,
    so no coplanar faces fight."""
    lo, hi = Vector(lo), Vector(hi)
    e = size
    x0 = x_start if x_start is not None else lo.x
    mb = H.MeshBuilder()
    for y0, y1 in ((lo.y, lo.y + e), (hi.y - e, hi.y)):
        for z0, z1 in ((lo.z, lo.z + e), (hi.z - e, hi.z)):
            mb.box((x0, y0, z0), (hi.x - e, y1, z1), "mat_frame")
    # +X end frame: full-height posts, rails between them
    for y0, y1 in ((lo.y, lo.y + e), (hi.y - e, hi.y)):
        mb.box((hi.x - e, y0, lo.z), (hi.x, y1, hi.z), "mat_frame")
    for z0, z1 in ((lo.z, lo.z + e), (hi.z - e, hi.z)):
        mb.box((hi.x - e, lo.y + e, z0), (hi.x, hi.y - e, z1), "mat_frame")
    if not open_min_x:
        for y0, y1 in ((lo.y, lo.y + e), (hi.y - e, hi.y)):
            mb.box((x0 - e, y0, lo.z), (x0, y1, hi.z), "mat_frame")
        for z0, z1 in ((lo.z, lo.z + e), (hi.z - e, hi.z)):
            mb.box((x0 - e, lo.y + e, z0), (x0, hi.y - e, z1), "mat_frame")
    ctr = (lo + hi) / 2
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world", bevel=bevel)


def flange_ring(scene, name, xs, y0, y1, z0, z1, width, parent=None, mat="mat_frame", bevel=0.002):
    """Rectangular ring(s) in YZ planes; xs = [(x0, x1), ...] thickness spans.
    Inner opening y0..y1 x z0..z1, grown outward by `width`."""
    hy, hz = (y1 - y0) / 2, (z1 - z0) / 2
    mb = H.MeshBuilder()
    for x0, x1 in xs:
        xf = H.basis((0, 1, 0), (0, 0, 1), (1, 0, 0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
        mb.plate((-hy - width, hy + width, -hz - width, hz + width), x1 - x0, mat, xf,
                 hole=("rect", -hy, hy, -hz, hz))
    ctr = Vector((sum(a + b for a, b in xs) / (2 * len(xs)), (y0 + y1) / 2, (z0 + z1) / 2))
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world", bevel=bevel)


def base_rail(scene, name, x0, x1, yc, width=0.08, height=0.153, flange=0.012, outward=1, parent=None):
    """C-channel skid rail along X (open side facing `outward` in Y)."""
    w2 = width / 2
    t = 0.008
    mb = H.MeshBuilder()
    # web on the inner side, flanges top/bottom pointing outward
    wy0, wy1 = (yc - w2, yc - w2 + t) if outward > 0 else (yc + w2 - t, yc + w2)
    mb.box((x0, wy0, 0.0), (x1, wy1, height), "mat_frame")
    fy0, fy1 = (wy1, yc + w2) if outward > 0 else (yc - w2, wy0)
    mb.box((x0, fy0, 0.0), (x1, fy1, flange), "mat_frame")
    mb.box((x0, fy0, height - flange), (x1, fy1, height), "mat_frame")
    ctr = Vector(((x0 + x1) / 2, yc, height / 2))
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world", bevel=0.003,
                        segments=1)


def rect_duct(scene, prefix, x0, x1, y0, y1, z0, z1, t=0.03, bottom_x=None, top=True, parent=None,
              mat="mat_duct", bevel=0.003, side_z0=None):
    """Rectangular duct stub along X: <prefix>_top/_bottom/_back/_front panels
    (front = -Y, flagged cutaway). Top/bottom span full width; sides sit
    between them. bottom_x restricts the bottom panel to an x-range (or False
    for no bottom). side_z0 lets side panels reach below the duct box (e.g. to
    sit on a roof)."""
    out = {}
    inner = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    if top:
        out["top"] = panel(scene, "%s_top" % prefix, (x0, y0, z1 - t), (x1, y1, z1), mat, parent=parent, bevel=bevel, inner=inner)
    if bottom_x is None:
        # full bottom: spans the full width, sides sit between top and bottom
        out["bottom"] = panel(scene, "%s_bottom" % prefix, (x0, y0, z0), (x1, y1, z0 + t), mat,
                              parent=parent, bevel=bevel, inner=inner)
        sz0 = z0 + t
    else:
        sz0 = side_z0 if side_z0 is not None else z0
        if bottom_x is not False:
            # partial bottom: sits between the side panels
            out["bottom"] = panel(scene, "%s_bottom" % prefix, (bottom_x[0], y0 + t, z0), (bottom_x[1], y1 - t, z0 + t),
                                  mat, parent=parent, bevel=bevel, inner=inner)
    sz1 = z1 - t if top else z1
    out["back"] = panel(scene, "%s_back" % prefix, (x0, y1 - t, sz0), (x1, y1, sz1), mat, parent=parent, bevel=bevel, inner=inner)
    out["front"] = panel(scene, "%s_front" % prefix, (x0, y0, sz0), (x1, y0 + t, sz1), mat, parent=parent, bevel=bevel, inner=inner)
    H.set_cutaway(out["front"])
    return out
