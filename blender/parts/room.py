"""Office-corner context for the VAV module: floor slab, back and left walls, a
lay-in ceiling (tiles + T-bar grid), a return grille, a wall thermostat and a
little furniture.

Cut like a dollhouse section: the front (-Y) and right (+X) sides are open and
every face lying in a cut plane is poured in mat_cut. All pieces are static,
with identity rotation and their origin at the piece center.
"""
import math

from mathutils import Matrix, Vector

import hvaclab as H
from parts import ductwork as D

WALL = "mat_room_wall"


def _center(lo, hi):
    return Matrix.Translation(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))


def floor(scene, name, x0, x1, y0, y1, t=0.15, carpet=0.012, parent=None):
    """Slab with its top at z = 0: carpet over a structural slab whose cut
    faces are all mat_cut."""
    mb = H.MeshBuilder()
    D.box6(mb, (x0, y0, -t), (x1, y1, -carpet), {}, D.CUT)
    D.box6(mb, (x0, y0, -carpet), (x1, y1, 0.0), {}, "mat_carpet", bw=0.4)
    return mb.to_object(scene, name, matrix=_center((x0, y0, -t), (x1, y1, 0.0)), parent=parent, space="world",
                        bevel=0.003, segments=1)


def wall(scene, name, boxes, parent=None):
    """Wall made of boxes [(lo, hi, {face: mat})]; unlisted faces are wall paint."""
    mb = H.MeshBuilder()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for a, b, mats in boxes:
        D.box6(mb, a, b, mats, WALL, bw=0.5)
        lo = Vector([min(lo[i], a[i]) for i in range(3)])
        hi = Vector([max(hi[i], b[i]) for i in range(3)])
    return mb.to_object(scene, name, matrix=_center(lo, hi), parent=parent, space="world", bevel=0.004, segments=1)


def _spans(lo, hi, cuts):
    out, cur = [], lo
    for a, b in sorted(cuts):
        if a > cur:
            out.append((cur, a))
        cur = max(cur, b)
    if cur < hi:
        out.append((cur, hi))
    return out


def ceiling_tiles(scene, name, x0, x1, ys, z_top, t, holes, cut_x=None, parent=None):
    """Lay-in tiles as a few big slabs, one per grid row (ys = row edges), with
    the cells in `holes` [(xa, xb, ya, yb)] left out for diffusers and grilles.
    The end faces at x = cut_x (section) are mat_cut."""
    mb = H.MeshBuilder()
    for ya, yb in zip(ys, ys[1:]):
        cuts = [(h[0], h[1]) for h in holes if h[2] <= ya + 1e-6 and h[3] >= yb - 1e-6]
        for xa, xb in _spans(x0, x1, cuts):
            mats = {"+x": D.CUT} if cut_x is not None and abs(xb - cut_x) < 1e-6 else {}
            D.box6(mb, (xa, ya, z_top - t), (xb, yb, z_top), mats, "mat_ceiling", bw=0.0)
    return mb.to_object(scene, name, matrix=Matrix.Translation(((x0 + x1) / 2, (ys[0] + ys[-1]) / 2, z_top - t / 2)),
                        parent=parent, space="world")


def ceiling_grid(scene, name, x_wall, x_end, y_front, y_wall, x_lines, y_lines, z_face, parent=None,
                 flange=0.024, flange_t=0.003, web=0.006, web_h=0.038):
    """Exposed T-bar grid, bottom of the flanges at z_face. Main tees run along
    Y (continuous), cross tees along X are cut between them, and wall angles run
    along the two walls. Pieces abut, so no two faces share a plane."""
    f2, w2 = flange / 2, web / 2
    zf1 = z_face + flange_t
    zw0, zw1 = zf1 - 0.001, z_face + web_h       # webs start inside the flange
    mb = H.MeshBuilder()
    # wall angles: horizontal leg + vertical leg against the wall
    xa = x_wall + flange - 0.002                 # the left angle's leg ends here
    mb.box((x_wall, y_front - f2, z_face), (xa, y_wall, zf1), "mat_tbar", bw=0.0)
    mb.box((x_wall, y_front - f2, zf1), (x_wall + 0.003, y_wall, z_face + 0.03), "mat_tbar", bw=0.0)
    yb = y_wall - flange + 0.002
    mb.box((xa, yb, z_face), (x_end, y_wall, zf1), "mat_tbar", bw=0.0)
    mb.box((x_wall + 0.003, y_wall - 0.003, zf1), (x_end, y_wall, z_face + 0.03), "mat_tbar", bw=0.0)
    # main tees along Y; webs end inside the back angle's leg, so their ends never share
    # a plane with the tiles' edges
    for x in x_lines:
        mb.box((x - f2, y_front - f2, z_face), (x + f2, yb, zf1), "mat_tbar", bw=0.0)
        mb.box((x - w2, y_front - w2, zw0), (x + w2, y_wall - 0.0015, zw1), "mat_tbar", bw=0.0)
    # cross tees along X between the mains (and the wall angle / cut end); webs start inside
    # the left angle's leg and stop a millimetre short of the section cut
    xs = [x_wall] + list(x_lines) + [x_end]
    for y in y_lines:
        for k, (a, b) in enumerate(zip(xs, xs[1:])):
            fa = xa if k == 0 else a + f2
            fb = b if k == len(xs) - 2 else b - f2
            wa = x_wall + 0.0015 if k == 0 else a + w2
            wb = b - 0.001 if k == len(xs) - 2 else b - w2
            mb.box((fa, y - f2, z_face), (fb, y + f2, zf1), "mat_tbar", bw=0.0)
            mb.box((wa, y - w2, zw0), (wb, y + w2, zw1), "mat_tbar", bw=0.0)
    ctr = ((x_wall + x_end) / 2, (y_front + y_wall) / 2, z_face)
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world")


def return_grille(scene, name, cx, cy, z_face, half=0.288, border=0.028, pitch=0.052, t=0.012,
                  mat="mat_diffuser", parent=None, explode=None):
    """Lay-in egg-crate return grille, open to the plenum above. Crossing slats
    differ in height by a millimetre top and bottom so their faces never share
    a plane."""
    mb = H.MeshBuilder()
    inner = half - border
    mb.plate((-half, half, -half, half), t, mat, Matrix.Translation((cx, cy, z_face + t / 2)),
             hole=("rect", -inner, inner, -inner, inner), bw=0.6)
    n = int(round(2 * inner / pitch))
    step = 2 * inner / n
    st = 0.0015
    for k in range(1, n):
        c = -inner + k * step
        mb.box((cx - inner - 0.001, cy + c - st, z_face + 0.0005), (cx + inner + 0.001, cy + c + st, z_face + t - 0.0005),
               mat, bw=0.0)
        mb.box((cx + c - st, cy - inner - 0.001, z_face + 0.0015), (cx + c + st, cy + inner + 0.001, z_face + t - 0.0015),
               mat, bw=0.0)
    obj = mb.to_object(scene, name, matrix=Matrix.Translation((cx, cy, z_face + t / 2)), parent=parent,
                       space="world", bevel=0.0015, segments=1)
    if explode is not None:
        H.set_explode(obj, explode)
    return obj


def thermostat(scene, name, x, y_wall, z, w=0.09, d=0.02, h=0.12, parent=None):
    """Wall thermostat on a wall face at y = y_wall (facing -Y): a rounded body
    with a darker display and two buttons."""
    mb = H.MeshBuilder()
    y0, y1 = y_wall - d, y_wall - 0.0005
    mb.box((x - w / 2, y0, z - h / 2), (x + w / 2, y1, z + h / 2), "mat_accent", bw=1.0)
    fy0, fy1 = y0 - 0.0012, y0 + 0.0008
    mb.box((x - 0.029, fy0, z + 0.004), (x + 0.029, fy1, z + 0.040), "mat_dark", bw=0.1)
    for bx in (-0.016, 0.016):
        mb.box((x + bx - 0.009, fy0, z - 0.034), (x + bx + 0.009, fy1, z - 0.024), "mat_frame", bw=0.1)
    return mb.to_object(scene, name, matrix=Matrix.Translation((x, (y0 + y1) / 2, z)), parent=parent,
                        space="world", bevel=0.007, segments=3)


def desk(scene, name, x0, x1, y0, y1, top_z=0.75, parent=None):
    """Desk: laminate top on two panel legs and a modesty panel."""
    mb = H.MeshBuilder()
    t = 0.028
    mb.box((x0, y0, top_z - t), (x1, y1, top_z), "mat_desk", bw=1.0)
    for lx in (x0 + 0.02, x1 - 0.05):
        mb.box((lx, y0 + 0.05, 0.0), (lx + 0.03, y1 - 0.04, top_z - t), "mat_frame", bw=0.6)
    mb.box((x0 + 0.05, y1 - 0.07, 0.34), (x1 - 0.05, y1 - 0.052, top_z - t), "mat_frame", bw=0.6)
    return mb.to_object(scene, name, matrix=Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, top_z / 2)),
                        parent=parent, space="world", bevel=0.004, segments=1)


def monitor(scene, name, cx, cy, desk_z, parent=None):
    """Flat monitor facing -Y on a stand, plus a keyboard in front of it."""
    mb = H.MeshBuilder()
    z = desk_z
    mb.box((cx - 0.10, cy - 0.07, z), (cx + 0.10, cy + 0.07, z + 0.012), "mat_frame", bw=0.8)
    mb.box((cx - 0.016, cy + 0.02, z + 0.012), (cx + 0.016, cy + 0.045, z + 0.2), "mat_frame", bw=0.6)
    sy0, sy1 = cy - 0.012, cy + 0.02
    mb.box((cx - 0.28, sy0, z + 0.13), (cx + 0.28, sy1, z + 0.47), "mat_frame", bw=1.0)
    mb.box((cx - 0.268, sy0 - 0.0012, z + 0.145), (cx + 0.268, sy0 + 0.001, z + 0.458), "mat_dark", bw=0.0)
    mb.box((cx - 0.19, cy - 0.33, z), (cx + 0.19, cy - 0.19, z + 0.016), "mat_frame", bw=0.8)
    return mb.to_object(scene, name, matrix=Matrix.Translation((cx, cy, z + 0.25)), parent=parent,
                        space="world", bevel=0.004, segments=1)


def chair(scene, name, cx, cy, parent=None):
    """Task chair facing +Y (toward the desk): seat, back, gas column and a
    five-star base."""
    mb = H.MeshBuilder()
    mb.box((cx - 0.23, cy - 0.21, 0.42), (cx + 0.23, cy + 0.23, 0.48), "mat_frame", bw=1.0)
    mb.box((cx - 0.21, cy - 0.27, 0.56), (cx + 0.21, cy - 0.215, 0.95), "mat_frame", bw=1.0)
    mb.box((cx - 0.02, cy - 0.255, 0.44), (cx + 0.02, cy - 0.18, 0.60), "mat_steel", bw=0.6)
    mb.cylinder((cx, cy, 0.08), (cx, cy, 0.425), 0.024, 12, "mat_steel", bw=0.0)
    for k in range(5):
        a = math.radians(90 + 72 * k)
        u = Vector((math.cos(a), math.sin(a), 0.0))
        xf = H.basis(u, Vector((0, 0, 1)).cross(u), (0, 0, 1), (cx, cy, 0.0))
        # legs overlap at the hub: stagger them a millimetre so their faces never share a plane
        mb.box((0.0, -0.018, 0.06 + 0.001 * k), (0.3, 0.018, 0.095 - 0.001 * k), "mat_frame", xf, bw=0.6)
        mb.box((0.26, -0.02, 0.0), (0.3, 0.02, 0.06), "mat_dark", xf, bw=0.6)
    return mb.to_object(scene, name, matrix=Matrix.Translation((cx, cy, 0.45)), parent=parent, space="world",
                        bevel=0.006, segments=2)
