"""Shared helpers for the interactive-HVAC asset generators.

Plain bpy/bmesh only, so the same code runs in an interactive Blender session
(via MCP) and headless (`blender -b -P blender/build.py -- <module>`).

Binding contract: docs/asset-conventions.md
  * Blender Z-up, meters, front = -Y.
  * Moving parts pivot on their origin and move about/along LOCAL X.
  * Assemblies are identity-rotation empties.
  * Metadata lives in object custom properties (exported as glTF extras).
"""
import math
import re

import bmesh
import bpy
from mathutils import Matrix, Vector

NAME_RE = re.compile(r"^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*(_\d{2})?$")
FLOW_RE = re.compile(r"^flow_(.+)_(\d{2})$")
MOTIONS = ("rotate", "translate", "spin", "link")
IDENT = Matrix.Identity(4)

# Exact names/colors from docs/asset-conventions.md. Values the doc leaves open
# (e.g. roughness of mat_dark) are picked to suit the stylized look.
PALETTE = {
    "mat_housing":  {"color": "#E9EAED", "roughness": 0.55, "metallic": 0.0},
    "mat_frame":    {"color": "#1E1F22", "roughness": 0.50, "metallic": 0.0},
    "mat_blade":    {"color": "#C4C7CA", "roughness": 0.35, "metallic": 0.6},
    "mat_actuator": {"color": "#FF5A1F", "roughness": 0.45, "metallic": 0.0},
    "mat_dark":     {"color": "#1C1D1F", "roughness": 0.60, "metallic": 0.0},
    "mat_steel":    {"color": "#8C8F93", "roughness": 0.35, "metallic": 0.8},
    "mat_duct":     {"color": "#D8D9DD", "roughness": 0.45, "metallic": 0.15},
    "mat_filter":   {"color": "#F1F1F3", "roughness": 0.90, "metallic": 0.0},
    "mat_sensor":   {"color": "#C8814F", "roughness": 0.35, "metallic": 0.7},
    "mat_accent":   {"color": "#F4F4F6", "roughness": 0.40, "metallic": 0.0},
    # duct liner on interior faces: darker than the skin so the cutaway reads as "inside",
    # light enough that the interior and the airflow stay legible
    "mat_liner":    {"color": "#6B6E75", "roughness": 0.85, "metallic": 0.0},
    # site context (roof-deck section and penthouse wall)
    "mat_deck":       {"color": "#C9CBD0", "roughness": 0.92, "metallic": 0.0},
    "mat_insulation": {"color": "#DCD6C6", "roughness": 0.95, "metallic": 0.0},
    "mat_concrete":   {"color": "#A9ACB2", "roughness": 0.90, "metallic": 0.0},
    "mat_wall":       {"color": "#E1E2E6", "roughness": 0.70, "metallic": 0.0},
    # coils module: section-cut poche, fin packs, tubes/bends, insulated pipe jacket, valve bodies
    "mat_cut":        {"color": "#3A3C41", "roughness": 0.90, "metallic": 0.0},
    "mat_fin":        {"color": "#DADDE1", "roughness": 0.45, "metallic": 0.35},
    "mat_copper":     {"color": "#C47A45", "roughness": 0.35, "metallic": 0.70},
    "mat_pipe":       {"color": "#DADCE0", "roughness": 0.60, "metallic": 0.0},
    "mat_valve":      {"color": "#B08D57", "roughness": 0.40, "metallic": 0.60},
    # vav module: office context (carpet, walls, lay-in ceiling + T-bar grid, desk top),
    # supply diffusers / return grille, silvery flex duct
    "mat_carpet":     {"color": "#7A7D84", "roughness": 0.95, "metallic": 0.0},
    "mat_room_wall":  {"color": "#E6E2DA", "roughness": 0.85, "metallic": 0.0},
    "mat_ceiling":    {"color": "#EFEFEC", "roughness": 0.90, "metallic": 0.0},
    "mat_tbar":       {"color": "#F8F8F6", "roughness": 0.50, "metallic": 0.0},
    "mat_diffuser":   {"color": "#F5F5F3", "roughness": 0.45, "metallic": 0.0},
    "mat_flex":       {"color": "#C9CCD1", "roughness": 0.40, "metallic": 0.50},
    "mat_desk":       {"color": "#C8C0B2", "roughness": 0.60, "metallic": 0.0},
}


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------

def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (_srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b), 1.0)


def ensure_materials():
    """Create (or reset) the palette materials. Idempotent."""
    out = {}
    for name, spec in PALETTE.items():
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        rgba = hex_to_linear_rgba(spec["color"])
        mat.diffuse_color = rgba
        mat.metallic = spec["metallic"]
        mat.roughness = spec["roughness"]
        # closed solids: export single-sided (glTF doubleSided = false) so outlines and culling behave
        mat.use_backface_culling = True
        if mat.node_tree is None:
            try:
                mat.use_nodes = True
            except Exception:
                pass
        nt = mat.node_tree
        nt.nodes.clear()
        out_node = nt.nodes.new("ShaderNodeOutputMaterial")
        out_node.location = (300, 0)
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Metallic"].default_value = spec["metallic"]
        bsdf.inputs["Roughness"].default_value = spec["roughness"]
        nt.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])
        out[name] = mat
    return out


def material(name):
    if name not in PALETTE:
        raise KeyError("material %r is not in the palette" % name)
    mat = bpy.data.materials.get(name)
    if mat is None:
        ensure_materials()
        mat = bpy.data.materials[name]
    return mat


# --------------------------------------------------------------------------
# Scene
# --------------------------------------------------------------------------

def _is_identity(m, eps=1e-6):
    n = len(m)
    return all(abs(m[i][j] - (1.0 if i == j else 0.0)) <= eps for i in range(n) for j in range(n))


def reset_scene(name):
    """Delete scene `name` (and only its objects), then create it fresh.

    Never touches objects that live in other scenes (e.g. the default
    Camera/Cube/Light)."""
    wm = bpy.context.window_manager
    old = bpy.data.scenes.get(name)
    new = bpy.data.scenes.new(name + "__building")
    if old is not None:
        for win in wm.windows:
            if win.scene == old:
                win.scene = new
        objs = [o for o in old.objects if len(o.users_scene) <= 1]
        datas = [o.data for o in objs if o.data is not None]
        colls = list(old.collection.children_recursive)
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
        for c in colls:
            bpy.data.collections.remove(c)
        bpy.data.scenes.remove(old)
        for d in datas:
            try:
                if d.users == 0:
                    if isinstance(d, bpy.types.Mesh):
                        bpy.data.meshes.remove(d)
                    elif isinstance(d, bpy.types.Camera):
                        bpy.data.cameras.remove(d)
                    elif isinstance(d, bpy.types.Light):
                        bpy.data.lights.remove(d)
                    elif isinstance(d, bpy.types.Curve):
                        bpy.data.curves.remove(d)
            except ReferenceError:
                pass
    new.name = name
    us = new.unit_settings
    us.system = "METRIC"
    us.scale_length = 1.0
    us.length_unit = "METERS"
    return new


def activate_scene(scene):
    win = bpy.context.window
    if win is None and bpy.context.window_manager.windows:
        win = bpy.context.window_manager.windows[0]
    if win is not None:
        win.scene = scene
    return win


# --------------------------------------------------------------------------
# Transforms / parenting
# --------------------------------------------------------------------------

def basis(x, y, z, origin=(0.0, 0.0, 0.0)):
    """4x4 matrix whose columns are the given axes + translation."""
    m = Matrix.Identity(4)
    for i, v in enumerate((x, y, z)):
        v = Vector(v)
        m[0][i], m[1][i], m[2][i] = v.x, v.y, v.z
    o = Vector(origin)
    m[0][3], m[1][3], m[2][3] = o.x, o.y, o.z
    return m


def frame_from_axis(origin, axis):
    """Right-handed frame whose local Z (w) runs along `axis`."""
    w = Vector(axis).normalized()
    hint = Vector((0, 0, 1)) if abs(w.z) < 0.9 else Vector((1, 0, 0))
    u = hint.cross(w).normalized()
    v = w.cross(u)
    return basis(u, v, w, origin)


def shaft_basis(shaft_axis, ref_axis, origin=(0, 0, 0)):
    """Frame with local X = shaft_axis, local Y = ref_axis (orthogonalized)."""
    x = Vector(shaft_axis).normalized()
    y = Vector(ref_axis)
    y = (y - x * y.dot(x)).normalized()
    z = x.cross(y)
    return basis(x, y, z, origin)


def world_matrix(obj):
    """World matrix computed from the parent chain (no depsgraph needed)."""
    if obj.parent is None:
        return obj.matrix_basis.copy()
    return world_matrix(obj.parent) @ obj.matrix_parent_inverse @ obj.matrix_basis


def set_parent(child, parent):
    """Parent without moving the child and with an identity parent-inverse, so
    the exported local TRS is exactly parent^-1 * child (pivots preserved)."""
    w = world_matrix(child)
    child.parent = parent
    child.matrix_parent_inverse = Matrix.Identity(4)
    child.matrix_basis = world_matrix(parent).inverted() @ w
    return child


def link(scene, obj, parent=None):
    scene.collection.objects.link(obj)
    if parent is not None:
        set_parent(obj, parent)
    return obj


def empty(scene, name, loc=(0, 0, 0), parent=None, size=0.05, display="PLAIN_AXES", matrix=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = display
    e.empty_display_size = size
    e.matrix_basis = matrix.copy() if matrix is not None else Matrix.Translation(Vector(loc))
    return link(scene, e, parent)


def assembly(scene, name, loc=(0, 0, 0), parent=None, explode=None):
    """Identity-rotation empty that groups a part assembly."""
    e = empty(scene, name, loc, parent=parent, size=0.12, display="CUBE")
    if explode is not None:
        set_explode(e, explode)
    return e


# --------------------------------------------------------------------------
# Custom properties (glTF extras)
# --------------------------------------------------------------------------

def set_motion(obj, motion, rng=None, drives=None):
    if motion not in MOTIONS:
        raise ValueError("bad motion %r" % motion)
    obj["motion"] = motion
    if rng is not None:
        obj["range"] = [float(rng[0]), float(rng[1])]
    if drives is not None:
        obj["drives"] = str(drives)
    return obj


def set_link(obj, frm, to):
    obj["motion"] = "link"
    obj["from"] = str(frm)
    obj["to"] = str(to)
    return obj


def set_explode(obj, vec):
    obj["explode"] = [float(v) for v in vec]
    return obj


def set_cutaway(obj):
    obj["cutaway"] = True
    return obj


def flow_path(scene, stream, points, spread=None, parent=None):
    """Chain of empties flow_<stream>_NN. points are (x, z) (y = 0) or (x, y, z).
    spread is one [across, normal] pair for every point, or a list per point."""
    per_point = spread is not None and len(spread) == len(points) and hasattr(spread[0], "__len__")
    out = []
    for i, p in enumerate(points):
        loc = (p[0], 0.0, p[1]) if len(p) == 2 else tuple(p)
        e = empty(scene, "flow_%s_%02d" % (stream, i), loc, parent=parent, size=0.04, display="SPHERE")
        s = spread[i] if per_point else spread
        if s is not None:
            e["spread"] = [float(s[0]), float(s[1])]
        out.append(e)
    return out


def anchor(scene, name, loc, parent=None):
    return empty(scene, "anchor_%s" % name, loc, parent=parent, size=0.05, display="SINGLE_ARROW")


# --------------------------------------------------------------------------
# Mesh building
# --------------------------------------------------------------------------

_BOX_FACES = (
    ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)),
    ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)),
    ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),
    ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)),
    ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)),
    ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),
)


def _signed_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return a * 0.5


def circle_pts(r, seg, cx=0.0, cy=0.0, phase=0.5):
    return [(cx + r * math.cos(2 * math.pi * (i + phase) / seg),
             cy + r * math.sin(2 * math.pi * (i + phase) / seg)) for i in range(seg)]


def offset_curve_2d(pts, d):
    """Offset an open 2D polyline by d along its left normal (miter-ish)."""
    out = []
    n = len(pts)
    for i in range(n):
        if i == 0:
            t = Vector(pts[1]) - Vector(pts[0])
        elif i == n - 1:
            t = Vector(pts[-1]) - Vector(pts[-2])
        else:
            t = (Vector(pts[i + 1]) - Vector(pts[i])).normalized() + (Vector(pts[i]) - Vector(pts[i - 1])).normalized()
        t.normalize()
        nrm = Vector((-t.y, t.x))
        out.append((pts[i][0] + nrm.x * d, pts[i][1] + nrm.y * d))
    return out


def _annulus_triangles(outer, inner, c):
    """Triangulate the region between two CCW star-shaped loops (as seen from
    center c) by merging them in angular order. Returns CCW triangles of keys
    ('o', i) / ('i', j)."""
    def ang(p):
        return math.atan2(p[1] - c[1], p[0] - c[0])

    def seq(loop, tag):
        a = [ang(p) for p in loop]
        start = min(range(len(loop)), key=lambda k: a[k])
        s = []
        prev = None
        for m in range(len(loop) + 1):
            k = (start + m) % len(loop)
            v = a[k]
            if prev is not None:
                while v <= prev:
                    v += 2 * math.pi
            s.append(((tag, k), v))
            prev = v
        return s

    so, si = seq(outer, "o"), seq(inner, "i")
    # make both sequences start in the same revolution
    while si[0][1] < so[0][1] - math.pi:
        si = [(k, v + 2 * math.pi) for k, v in si]
    while si[0][1] > so[0][1] + math.pi:
        si = [(k, v - 2 * math.pi) for k, v in si]
    tris = []
    i = j = 0
    while i < len(so) - 1 or j < len(si) - 1:
        adv_o = j >= len(si) - 1 or (i < len(so) - 1 and so[i + 1][1] <= si[j + 1][1])
        if adv_o:
            tris.append((so[i][0], so[i + 1][0], si[j][0]))
            i += 1
        else:
            tris.append((so[i][0], si[j + 1][0], si[j][0]))
            j += 1
    return tris


class MeshBuilder:
    """Accumulates closed primitives into one bmesh.

    Every primitive takes a material name (palette) and a bevel weight `bw`
    (0..1, relative to the object's bevel width). At finalization, edges sharper
    than the smoothing angle get the primitive's bevel weight; a live Bevel
    modifier (limit=WEIGHT, harden normals) is added and applied at export."""

    def __init__(self):
        self.bm = bmesh.new()
        self.slots = []
        self.face_bw = {}

    def mi(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def _face(self, verts, mat, bw):
        f = self.bm.faces.new(verts)
        f.material_index = self.mi(mat)
        self.face_bw[f] = bw
        return f

    def _v(self, xf, p):
        return self.bm.verts.new(xf @ Vector(p))

    # -- primitives ---------------------------------------------------------
    def box(self, lo, hi, mat, xf=IDENT, bw=1.0):
        c = {}
        for ix in (0, 1):
            for iy in (0, 1):
                for iz in (0, 1):
                    c[(ix, iy, iz)] = self._v(xf, (hi[0] if ix else lo[0], hi[1] if iy else lo[1], hi[2] if iz else lo[2]))
        for quad in _BOX_FACES:
            self._face([c[k] for k in quad], mat, bw)

    def extrude(self, pts, w0, w1, mat, xf=IDENT, bw=1.0, caps=True):
        """Extrude a closed 2D polygon (u, v) from w0 to w1 in frame xf."""
        pts = list(pts)
        if _signed_area(pts) < 0:
            pts.reverse()
        bot = [self._v(xf, (u, v, w0)) for u, v in pts]
        top = [self._v(xf, (u, v, w1)) for u, v in pts]
        n = len(pts)
        if caps:
            self._face(top, mat, bw)
            self._face(list(reversed(bot)), mat, bw)
        for i in range(n):
            j = (i + 1) % n
            self._face([bot[i], bot[j], top[j], top[i]], mat, bw)
        return bot, top

    def cylinder(self, p0, p1, r, seg, mat, xf=IDENT, bw=1.0, phase=0.5):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        self.extrude(circle_pts(r, seg, phase=phase), 0.0, d.length, mat, xf @ frame_from_axis(p0, d), bw)

    def lathe(self, profile, seg, mat, xf=IDENT, bw=1.0):
        """Revolve a closed (axial, radius) loop about local X of frame xf."""
        rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ca, sa = math.cos(a), math.sin(a)
            rings.append([self._v(xf, (x, r * ca, r * sa)) for x, r in profile])
        n = len(profile)
        for i in range(seg):
            A, B = rings[i], rings[(i + 1) % seg]
            for j in range(n):
                k = (j + 1) % n
                self._face([A[j], A[k], B[k], B[j]], mat, bw)

    def tube(self, pts, r, seg, mat, xf=IDENT, bw=1.0, caps=True):
        """Sweep a circle along a polyline (parallel-transport frames)."""
        P = [Vector(p) for p in pts]
        n = len(P)
        T = []
        for i in range(n):
            if i == 0:
                t = P[1] - P[0]
            elif i == n - 1:
                t = P[-1] - P[-2]
            else:
                t = (P[i + 1] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()
            T.append(t.normalized())
        hint = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
        N = [(hint - T[0] * hint.dot(T[0])).normalized()]
        for i in range(1, n):
            nn = N[-1] - T[i] * N[-1].dot(T[i])
            N.append(nn.normalized())
        rings = []
        for i in range(n):
            B = T[i].cross(N[i])
            ring = []
            for k in range(seg):
                a = 2 * math.pi * k / seg
                ring.append(self._v(xf, P[i] + (N[i] * math.cos(a) + B * math.sin(a)) * r))
            rings.append(ring)
        for i in range(n - 1):
            A, Bn = rings[i], rings[i + 1]
            for k in range(seg):
                m = (k + 1) % seg
                self._face([A[k], A[m], Bn[m], Bn[k]], mat, bw)
        if caps:
            self._face(list(reversed(rings[0])), mat, bw)
            self._face(rings[-1], mat, bw)

    def plate(self, outer, t, mat, xf=IDENT, hole=None, bw=1.0):
        """Flat plate in the UV plane of xf, thickness t along W (centered).
        outer = (u0, u1, v0, v1); hole = ('rect', u0, u1, v0, v1) or
        ('circle', cu, cv, r, seg)."""
        u0, u1, v0, v1 = outer
        if hole is None:
            self.box((u0, v0, -t / 2), (u1, v1, t / 2), mat, xf, bw)
            return
        O = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        if hole[0] == "rect":
            _, a0, a1, b0, b1 = hole
            I = [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]
            c = ((a0 + a1) / 2, (b0 + b1) / 2)
        else:
            _, cu, cv, r, seg = hole
            I = circle_pts(r, seg, cu, cv)
            c = (cu, cv)
            # sample the outer rectangle along the circle's rays (plus the
            # corners) so the annulus becomes even strips instead of long fans
            # converging on the corners (which the bevel modifier mangles)
            samples = []
            for (px, py) in I:
                dx, dy = px - cu, py - cv
                ts = []
                if dx > 1e-9:
                    ts.append((u1 - cu) / dx)
                if dx < -1e-9:
                    ts.append((u0 - cu) / dx)
                if dy > 1e-9:
                    ts.append((v1 - cv) / dy)
                if dy < -1e-9:
                    ts.append((v0 - cv) / dy)
                t_hit = min(ts)
                samples.append((cu + dx * t_hit, cv + dy * t_hit))
            pts = samples + O
            pts.sort(key=lambda p: math.atan2(p[1] - cv, p[0] - cu))
            O = []
            for p in pts:
                if not O or (abs(p[0] - O[-1][0]) > 1e-6 or abs(p[1] - O[-1][1]) > 1e-6):
                    O.append(p)
            if len(O) > 1 and abs(O[0][0] - O[-1][0]) < 1e-6 and abs(O[0][1] - O[-1][1]) < 1e-6:
                O.pop()
        top, bot = {}, {}
        for tag, loop in (("o", O), ("i", I)):
            for k, (u, v) in enumerate(loop):
                top[(tag, k)] = self._v(xf, (u, v, t / 2))
                bot[(tag, k)] = self._v(xf, (u, v, -t / 2))
        for a, b, cc in _annulus_triangles(O, I, c):
            self._face([top[a], top[b], top[cc]], mat, bw)
            self._face([bot[cc], bot[b], bot[a]], mat, bw)
        n = len(O)
        for i in range(n):
            j = (i + 1) % n
            self._face([bot[("o", i)], bot[("o", j)], top[("o", j)], top[("o", i)]], mat, bw)
        n = len(I)
        for i in range(n):
            j = (i + 1) % n
            self._face([bot[("i", j)], bot[("i", i)], top[("i", i)], top[("i", j)]], mat, bw)

    def line_interior(self, axis, inner, mat="mat_liner"):
        """Re-material the big faces (normal along world `axis`) that face the
        enclosure: toward point `inner`, or both sides when inner == "both"."""
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.normal_update()
        li = self.mi(mat)
        for f in bm.faces:
            n = f.normal
            if abs(n[axis]) < 0.9:
                continue
            if inner == "both" or (Vector(inner) - f.calc_center_median()).dot(n) > 0:
                f.material_index = li

    def solid_strip(self, rows, mat, xf=IDENT, bw=1.0):
        """Closed solid from a list of 4-vertex cross-sections (each CCW-ish);
        consecutive rows are bridged, ends capped."""
        rings = [[self._v(xf, p) for p in row] for row in rows]
        for i in range(len(rings) - 1):
            A, B = rings[i], rings[i + 1]
            k = len(A)
            for a in range(k):
                b = (a + 1) % k
                self._face([A[a], A[b], B[b], B[a]], mat, bw)
        self._face(list(reversed(rings[0])), mat, bw)
        self._face(rings[-1], mat, bw)

    # -- output --------------------------------------------------------------
    def to_object(self, scene, name, matrix=None, parent=None, space="local",
                  bevel=0.0, segments=2, smooth_angle=30.0):
        """Create the object. `matrix` is its world matrix. If space == 'world'
        the accumulated geometry is in world coordinates and is moved into the
        object's local space; otherwise it is already local."""
        matrix = matrix.copy() if matrix is not None else Matrix.Identity(4)
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.normal_update()
        if space == "world":
            bmesh.ops.transform(bm, matrix=matrix.inverted(), verts=list(bm.verts))
            bm.normal_update()
        limit = math.radians(smooth_angle)
        layer = bm.edges.layers.float.get("bevel_weight_edge") or bm.edges.layers.float.new("bevel_weight_edge")
        for e in bm.edges:
            w = 0.0
            if e.is_manifold and e.calc_face_angle(0.0) > limit:
                w = min(self.face_bw.get(f, 1.0) for f in e.link_faces)
            e[layer] = max(0.0, min(1.0, w))
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        self.bm = None
        for s in self.slots:
            me.materials.append(material(s))
        obj = bpy.data.objects.new(name, me)
        obj.matrix_basis = matrix
        link(scene, obj, parent)
        finish(obj, bevel=bevel, segments=segments, smooth_angle=smooth_angle)
        return obj


def finish(obj, bevel=0.0, segments=2, smooth_angle=30.0):
    """Smooth shading + sharp edges by angle, and an optional live Bevel
    modifier (weight-limited, harden normals). Modifiers are applied by the
    glTF exporter (export_apply=True)."""
    me = obj.data
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "WEIGHT"
        mod.harden_normals = True
        mod.use_clamp_overlap = True
        mod.miter_outer = "MITER_ARC"
    return obj


# --------------------------------------------------------------------------
# Checks / export
# --------------------------------------------------------------------------

def _local_bbox(obj):
    vs = [v.co for v in obj.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return lo, hi


def self_check(scene, required=(), drives=None, pad=0.02):
    """Pre-export sanity checks. Returns a list of error strings."""
    errors = []
    objs = [o for o in scene.objects if o.type in {"MESH", "EMPTY"}]
    names = {o.name for o in objs}
    for o in objs:
        if not NAME_RE.match(o.name):
            errors.append("name %r does not match %s" % (o.name, NAME_RE.pattern))
        if not _is_identity(o.matrix_parent_inverse):
            errors.append("%s: parent inverse is not identity" % o.name)
        m = o.get("motion")
        if m is not None:
            if m not in MOTIONS:
                errors.append("%s: bad motion %r" % (o.name, m))
            elif m == "link":
                for k in ("from", "to"):
                    if o.get(k) not in names:
                        errors.append("%s: link %s=%r is not a node" % (o.name, k, o.get(k)))
            else:
                r = o.get("range")
                if r is None or len(r) != 2:
                    errors.append("%s: range must be [min, max]" % o.name)
                d = o.get("drives")
                if not isinstance(d, str):
                    errors.append("%s: drives must be a string" % o.name)
                elif drives is not None and d not in drives:
                    errors.append("%s: drives %r not in %s" % (o.name, d, list(drives)))
            if o.type == "MESH" and m != "link":
                lo, hi = _local_bbox(o)
                if not all(lo[i] - pad <= 0.0 <= hi[i] + pad for i in range(3)):
                    errors.append("%s: origin outside its mesh bbox (pivot not on part)" % o.name)
        if "explode" in o.keys():
            if len(o["explode"]) != 3:
                errors.append("%s: explode must be [x,y,z]" % o.name)
            if o.type == "EMPTY" and not _is_identity(world_matrix(o).to_3x3().to_4x4()):
                errors.append("%s: assembly empty must have identity rotation" % o.name)
        if o.type == "MESH":
            for s in o.material_slots:
                if s.material is None or s.material.name not in PALETTE:
                    errors.append("%s: material %r not in palette" % (o.name, s.material and s.material.name))
    flows = {}
    for o in objs:
        mm = FLOW_RE.match(o.name)
        if mm:
            flows.setdefault(mm.group(1), []).append(int(mm.group(2)))
    for s, idx in flows.items():
        idx.sort()
        if idx != list(range(len(idx))) or len(idx) < 2:
            errors.append("flow %s: indices %s not contiguous from 00 (>=2)" % (s, idx))
    if not any(o.name.startswith("anchor_") for o in objs):
        errors.append("no anchor_* empties")
    for r in required:
        if r not in names:
            errors.append("required node %r missing" % r)
    return errors


def tri_count(scene):
    dg = scene.view_layers[0].depsgraph
    dg.update()
    total = 0
    per = {}
    for o in scene.objects:
        if o.type != "MESH":
            continue
        oe = o.evaluated_get(dg)
        me = oe.to_mesh()
        me.calc_loop_triangles()
        per[o.name] = len(me.loop_triangles)
        total += per[o.name]
        oe.to_mesh_clear()
    return total, per


def export_glb(scene, path):
    """GLB, +Y up, extras on, modifiers applied, no cameras/lights/animation,
    only the given scene."""
    activate_scene(scene)
    scene.view_layers[0].update()
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kw = dict(
        filepath=path, check_existing=False, export_format="GLB",
        export_yup=True, export_extras=True, export_apply=True,
        export_cameras=False, export_lights=False, export_animations=False,
        use_active_scene=True, use_selection=False, use_visible=False,
        export_materials="EXPORT", export_normals=True, export_texcoords=False,
        export_tangents=False, export_attributes=False, export_skins=False,
        export_morph=False, export_vertex_color="NONE", will_save_settings=False,
    )
    kw = {k: v for k, v in kw.items() if k in props}
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop("export_vertex_color", None)
        bpy.ops.export_scene.gltf(**kw)
    return path
