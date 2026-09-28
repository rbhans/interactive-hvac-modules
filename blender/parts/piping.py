"""Hydronic piping for a coil: insulated supply/return runs with elbows, a
flanged 2-way globe control valve with a linear actuator (moving stem and
position indicator), isolation ball valves, a circuit-balancing valve, dial
thermometers and roof-penetration curbs.

Routes are corner polylines whose interior corners are filleted into elbows
(centerline radius `bend_r`). Inline fittings are placed by a world point on a
straight run; the insulation jacket is interrupted around them. The jacket
objects use `mat_pipe` only (the runtime recolors them by water temperature);
every fitting is its own object. Static fittings have identity rotation and
their origin on the pipe axis.
"""
import math

from mathutils import Matrix, Vector

import hvaclab as H

UP = Vector((0.0, 0.0, 1.0))
BACK = Vector((0.0, 1.0, 0.0))
FRONT = Vector((0.0, -1.0, 0.0))
INS_CLEAR = 0.012       # bare pipe showing between an insulation end and a fitting


def _dedupe(pts, eps=1e-6):
    out = []
    for p in pts:
        if not out or (p - out[-1]).length > eps:
            out.append(p.copy())
    return out


class Route:
    """Filleted polyline with an arc-length parameter s."""

    def __init__(self, corners, bend_r, arc_steps=6):
        P = [Vector(c) for c in corners]
        radii = bend_r if hasattr(bend_r, "__len__") else [bend_r] * max(0, len(P) - 2)
        pts, keys = [P[0].copy()], [P[0].copy()]
        for i in range(1, len(P) - 1):
            a, b, c = P[i - 1], P[i], P[i + 1]
            d1, d2 = (b - a).normalized(), (c - b).normalized()
            cs = max(-1.0, min(1.0, d1.dot(d2)))
            th = math.acos(cs)
            if th < 1e-4:
                pts.append(b.copy())
                continue
            r = radii[i - 1]
            t = r * math.tan(th / 2)
            nv = (d2 - d1 * cs).normalized()
            ctr = b - d1 * t + nv * r
            steps = max(2, int(math.ceil(arc_steps * th / (math.pi / 2))))
            arc = [ctr + (-nv * math.cos(th * k / steps) + d1 * math.sin(th * k / steps)) * r
                   for k in range(steps + 1)]
            pts.extend(arc)
            keys.extend([arc[0], arc[len(arc) // 2], arc[-1]])
        pts.append(P[-1].copy())
        keys.append(P[-1].copy())
        self.corners = P
        self.pts = _dedupe(pts)
        self.keys = _dedupe(keys)
        self.s = [0.0]
        for p, q in zip(self.pts, self.pts[1:]):
            self.s.append(self.s[-1] + (q - p).length)
        self.length = self.s[-1]

    def locate(self, s):
        s = max(0.0, min(self.length, s))
        for i in range(len(self.s) - 1):
            if self.s[i + 1] >= s:
                seg = self.s[i + 1] - self.s[i]
                f = (s - self.s[i]) / seg if seg > 0 else 0.0
                return self.pts[i].lerp(self.pts[i + 1], f), (self.pts[i + 1] - self.pts[i]).normalized()
        return self.pts[-1].copy(), (self.pts[-1] - self.pts[-2]).normalized()

    def s_of(self, point):
        q = Vector(point)
        best = (1e9, 0.0)
        for i in range(len(self.pts) - 1):
            a, b = self.pts[i], self.pts[i + 1]
            d = b - a
            L2 = d.length_squared
            f = 0.0 if L2 == 0 else max(0.0, min(1.0, (q - a).dot(d) / L2))
            dist = (a + d * f - q).length
            if dist < best[0]:
                best = (dist, self.s[i] + f * math.sqrt(L2))
        return best[1]

    def slice(self, s0, s1):
        p0, _ = self.locate(s0)
        p1, _ = self.locate(s1)
        mid = [p for p, s in zip(self.pts, self.s) if s0 + 1e-6 < s < s1 - 1e-6]
        return _dedupe([p0] + mid + [p1])

    def flow_points(self, s0=0.0, s1=None, max_gap=0.2):
        """Centerline samples for a flow_* chain: the route start/end, each elbow's
        start/middle/end, and extra points on long straights."""
        s1 = self.length if s1 is None else s1
        ks = sorted({self.s_of(k) for k in self.keys} | {s0, s1})
        ks = [s for s in ks if s0 - 1e-6 <= s <= s1 + 1e-6]
        out = [ks[0]]
        for a, b in zip(ks, ks[1:]):
            n = int(math.ceil((b - a) / max_gap))
            out.extend(a + (b - a) * k / n for k in range(1, n + 1))
        return [self.locate(s)[0] for s in out]


def frame(route, s, up=UP):
    """Fitting frame at s: X along the pipe, Z toward `up`. On runs where it is
    possible, X is flipped so that local +Y points to the back (+Y world), i.e.
    local -Y faces the viewer."""
    p, t = route.locate(s)
    x = t.copy()
    z = Vector(up) - x * x.dot(Vector(up))
    if z.length < 1e-6:
        z = FRONT - x * x.dot(FRONT)
    z.normalize()
    y = z.cross(x)
    if y.dot(BACK) < -1e-6:
        x, y = -x, -y
    return H.basis(x, y, z, p), p


def _spans(lo, hi, gaps):
    out, cur = [], lo
    for a, b in sorted(gaps):
        if b <= cur or a >= hi:
            continue
        if a > cur:
            out.append((cur, a))
        cur = max(cur, b)
    if cur < hi:
        out.append((cur, hi))
    return out


def jacket(scene, name, route, r, gaps=(), s0=0.0, s1=None, seg=16, parent=None):
    """Insulated pipe (mat_pipe only): the route swept with radius r, interrupted
    by `gaps` [(s_a, s_b), ...] where inline fittings sit."""
    s1 = route.length if s1 is None else s1
    mb = H.MeshBuilder()
    for a, b in _spans(s0, s1, gaps):
        if b - a > 2e-3:
            mb.tube(route.slice(a, b), r, seg, "mat_pipe", bw=0.0)
    ps = route.pts
    lo = Vector([min(p[i] for p in ps) for i in range(3)])
    hi = Vector([max(p[i] for p in ps) for i in range(3)])
    return mb.to_object(scene, name, matrix=Matrix.Translation((lo + hi) / 2), parent=parent, space="world")


def _nipple(mb, M, half, rb):
    """Bare pipe through a fitting; its ends hide inside the insulation."""
    mb.cylinder((-half - 0.012, 0, 0), (half + 0.012, 0, 0), rb, 12, "mat_steel", M, bw=0.0)


def ball_valve(scene, name, route, point, rb, up=UP, lever=1.0, lever_len=None, parent=None):
    """Two-piece ball valve with a lever handle (open = lever along the pipe).
    Returns (object, jacket gap)."""
    s = route.s_of(point)
    M, p = frame(route, s, up)
    L = 4.4 * rb
    gap = L / 2 + INS_CLEAR
    mb = H.MeshBuilder()
    _nipple(mb, M, gap, rb)
    h = rb * 1.5
    mb.cylinder((-L / 2, 0, 0), (-L / 2 + 0.016, 0, 0), h, 6, "mat_valve", M, bw=0.6)
    mb.cylinder((L / 2 - 0.016, 0, 0), (L / 2, 0, 0), h, 6, "mat_valve", M, bw=0.6)
    a = L / 2 - 0.014
    mb.lathe([(-a, rb * 1.25), (-a * 0.55, rb * 1.95), (a * 0.55, rb * 1.95), (a, rb * 1.25),
              (a, rb * 0.95), (-a, rb * 0.95)], 16, "mat_valve", M, bw=0.5)
    z0 = rb * 1.8
    mb.cylinder((0, 0, z0 - 0.007), (0, 0, z0 + 0.024), 0.0055, 10, "mat_steel", M, bw=0.0)
    mb.cylinder((0, 0, z0 - 0.004), (0, 0, z0 + 0.009), 0.011, 6, "mat_valve", M, bw=0.5)
    zl = z0 + 0.018
    ll = lever_len or (0.10 + 2 * rb)
    sx = 1.0 if lever >= 0 else -1.0
    xa, xb = sorted((-0.012 * sx, ll * sx))
    mb.box((xa, -0.008, zl), (xb, 0.008, zl + 0.005), "mat_steel", M, bw=0.4)
    ga, gb = sorted((ll * 0.5 * sx, (ll + 0.004) * sx))
    mb.box((ga, -0.0105, zl - 0.0025), (gb, 0.0105, zl + 0.0075), "mat_dark", M, bw=1.0)
    mb.cylinder((0, 0, zl + 0.004), (0, 0, zl + 0.010), 0.0075, 6, "mat_steel", M, bw=0.3)
    obj = mb.to_object(scene, name, matrix=Matrix.Translation(p), parent=parent, space="world",
                       bevel=0.0012, segments=1)
    return obj, (s - gap, s + gap)


def balancing_valve(scene, name, route, point, rb, up=UP, parent=None):
    """Circuit-balancing valve (circuit setter): union ends, globe body, bonnet
    with a handwheel and memory-stop cap, two P/T test ports."""
    s = route.s_of(point)
    M, p = frame(route, s, up)
    L = 5.2 * rb + 0.01
    gap = L / 2 + INS_CLEAR
    mb = H.MeshBuilder()
    _nipple(mb, M, gap, rb)
    h = rb * 1.55
    mb.cylinder((-L / 2, 0, 0), (-L / 2 + 0.018, 0, 0), h, 6, "mat_valve", M, bw=0.6)
    mb.cylinder((L / 2 - 0.018, 0, 0), (L / 2, 0, 0), h, 6, "mat_valve", M, bw=0.6)
    a = L / 2 - 0.016
    mb.lathe([(-a, rb * 1.3), (-a * 0.6, rb * 1.9), (0, rb * 2.15), (a * 0.6, rb * 1.9), (a, rb * 1.3),
              (a, rb * 0.95), (-a, rb * 0.95)], 16, "mat_valve", M, bw=0.5)
    zb = rb * 1.7
    mb.cylinder((0, 0, zb), (0, 0, zb + 0.03), rb * 1.05, 16, "mat_valve", M, bw=0.6)
    mb.cylinder((0, 0, zb + 0.028), (0, 0, zb + 0.043), 0.028, 24, "mat_dark", M, bw=1.0)
    mb.cylinder((0, 0, zb + 0.042), (0, 0, zb + 0.047), 0.013, 16, "mat_accent", M, bw=0.5)
    for sx in (1, -1):
        px = sx * (L / 2 - 0.024)
        mb.cylinder((px, 0, rb * 1.1), (px, 0, rb * 1.5 + 0.018), 0.0055, 8, "mat_valve", M, bw=0.0)
        mb.cylinder((px, 0, rb * 1.5 + 0.016), (px, 0, rb * 1.5 + 0.026), 0.0075, 8, "mat_dark", M, bw=0.5)
    obj = mb.to_object(scene, name, matrix=Matrix.Translation(p), parent=parent, space="world",
                       bevel=0.0012, segments=1)
    return obj, (s - gap, s + gap)


def thermometer(scene, name, route, point, ri, dial_r=0.032, parent=None):
    """Bimetal dial thermometer in a well on top of a horizontal run, dial facing
    the front (-Y)."""
    s = route.s_of(point)
    p, _ = route.locate(s)
    mb = H.MeshBuilder()
    ztop = p.z + ri
    mb.cylinder((p.x, p.y, ztop - 0.008), (p.x, p.y, ztop + 0.010), 0.010, 12, "mat_steel", bw=0.6)
    mb.cylinder((p.x, p.y, ztop - 0.003), (p.x, p.y, ztop + 0.004), 0.013, 6, "mat_steel", bw=0.6)
    zc = ztop + 0.028 + dial_r
    mb.cylinder((p.x, p.y, ztop + 0.009), (p.x, p.y, zc - dial_r + 0.004), 0.004, 8, "mat_steel", bw=0.0)
    yf = p.y - 0.011                                   # front face of the case
    mb.cylinder((p.x, p.y + 0.011, zc), (p.x, yf, zc), dial_r, 24, "mat_steel", bw=1.0)
    mb.cylinder((p.x, yf + 0.001, zc), (p.x, yf - 0.0015, zc), dial_r - 0.0045, 24, "mat_accent", bw=0.0)
    a = math.radians(40)
    F = H.basis((math.sin(a), 0, math.cos(a)), (0, 1, 0), (-math.cos(a), 0, math.sin(a)), (p.x, 0.0, zc))
    mb.box((-0.005, yf - 0.0027, -0.0013), (dial_r * 0.72, yf - 0.0012, 0.0013), "mat_dark", F, bw=0.0)
    mb.cylinder((p.x, yf - 0.0005, zc), (p.x, yf - 0.0032, zc), 0.0035, 8, "mat_dark", bw=0.0)
    for ang in (-120, -60, 0, 60, 120):
        b = math.radians(ang)
        G = H.basis((math.sin(b), 0, math.cos(b)), (0, 1, 0), (-math.cos(b), 0, math.sin(b)), (p.x, 0.0, zc))
        mb.box((dial_r * 0.66, yf - 0.0021, -0.0008), (dial_r * 0.86, yf - 0.0012, 0.0008), "mat_dark", G, bw=0.0)
    return mb.to_object(scene, name, matrix=Matrix.Translation((p.x, p.y, zc)), parent=parent, space="world",
                        bevel=0.0012, segments=1)


def control_valve(scene, prefix, route, point, rb, drive, travel=0.022, parent=None):
    """Flanged 2-way globe valve `<prefix>_valve` (static) with a static linear
    actuator `<prefix>_valve_actuator` on a yoke, a moving stem + coupling
    `<prefix>_valve_stem` and a position pointer `<prefix>_valve_indicator`.
    Stem and indicator translate along local +X (= world up) by `travel` m;
    their origins sit at the closed position. Returns a dict."""
    s = route.s_of(point)
    M, p = frame(route, s, UP)
    X, Y, Z = (Vector(M.col[i][:3]) for i in range(3))
    L = 7.0 * rb + 0.02
    fr, ft = rb * 2.6, 0.013
    gap = L / 2 + ft + INS_CLEAR
    mb = H.MeshBuilder()
    _nipple(mb, M, gap, rb)
    for sx in (1, -1):
        a0, a1 = sorted((sx * (L / 2 - ft), sx * L / 2))
        mb.cylinder((a0, 0, 0), (a1, 0, 0), fr, 20, "mat_valve", M, bw=1.0)             # valve flange
        b0, b1 = sorted((sx * (L / 2 + 0.001), sx * (L / 2 + ft)))
        mb.cylinder((b0, 0, 0), (b1, 0, 0), fr, 20, "mat_steel", M, bw=1.0)             # pipe flange
        c0, c1 = sorted((sx * (L / 2 - ft - 0.004), sx * (L / 2 + ft + 0.005)))
        for k in range(4):
            ang = math.pi / 4 + k * math.pi / 2
            yy, zz = fr * 0.76 * math.cos(ang), fr * 0.76 * math.sin(ang)
            mb.cylinder((c0, yy, zz), (c1, yy, zz), 0.0038, 6, "mat_steel", M, bw=0.0)
    a = L / 2 - ft + 0.001
    mb.lathe([(-a, rb * 1.3), (-a + 0.012, rb * 1.55), (-a * 0.45, rb * 2.35), (0, rb * 2.5), (a * 0.45, rb * 2.35),
              (a - 0.012, rb * 1.55), (a, rb * 1.3), (a, rb * 0.95), (-a, rb * 0.95)], 20, "mat_valve", M, bw=0.4)
    zf = rb * 2.35
    mb.cylinder((0, 0, rb * 1.8), (0, 0, zf + 0.022), rb * 1.4, 16, "mat_valve", M, bw=0.6)     # bonnet
    mb.cylinder((0, 0, zf - 0.002), (0, 0, zf + 0.009), rb * 2.0, 20, "mat_valve", M, bw=0.8)   # bonnet flange
    zb = zf + 0.022 + 0.012
    mb.cylinder((0, 0, zf + 0.021), (0, 0, zb), 0.016, 6, "mat_valve", M, bw=0.6)               # packing nut
    body = mb.to_object(scene, "%s_valve" % prefix, matrix=Matrix.Translation(p), parent=parent, space="world",
                        bevel=0.0015, segments=1)

    # ---- actuator (static): yoke, base plate, housing, scale ---------------------
    zy = zb + 0.085                # yoke top / actuator base plate
    zc0 = zb + 0.025               # stem coupling center, closed
    hz0 = zy + 0.008
    hz1 = hz0 + 0.135
    ab = H.MeshBuilder()
    ab.cylinder((0, 0, zb - 0.002), (0, 0, zb + 0.008), 0.022, 16, "mat_steel", M, bw=0.6)
    for sx in (1, -1):
        x0, x1 = sorted((sx * 0.029, sx * 0.043))
        ab.box((x0, -0.010, zb + 0.004), (x1, 0.010, zy + 0.001), "mat_steel", M, bw=0.5)
    ab.box((-0.052, -0.042, zy), (0.052, 0.042, hz0), "mat_steel", M, bw=0.5)
    ab.box((-0.062, -0.052, hz0), (0.062, 0.052, hz1), "mat_actuator", M, bw=1.0)
    ab.box((-0.040, -0.0535, hz0 + 0.068), (0.040, -0.051, hz0 + 0.110), "mat_accent", M, bw=0.1)
    ab.box((-0.040, -0.0535, hz0 + 0.050), (0.004, -0.051, hz0 + 0.058), "mat_accent", M, bw=0.1)
    ab.cylinder((0, 0, hz1 - 0.002), (0, 0, hz1 + 0.012), 0.017, 16, "mat_dark", M, bw=0.6)       # manual override
    ab.cylinder((0.061, 0, hz0 + 0.035), (0.078, 0, hz0 + 0.035), 0.008, 10, "mat_dark", M, bw=0.3)  # cable gland
    # travel scale on the front of the -X yoke post: marks at closed and open
    ab.box((-0.043, -0.0115, zc0 - 0.012), (-0.029, -0.0098, zc0 + travel + 0.012), "mat_accent", M, bw=0.1)
    for zz in (zc0, zc0 + travel):
        ab.box((-0.043, -0.0122, zz - 0.001), (-0.034, -0.0110, zz + 0.001), "mat_dark", M, bw=0.0)
    act_o = p + Z * ((hz0 + hz1) / 2)
    actuator = ab.to_object(scene, "%s_valve_actuator" % prefix, matrix=Matrix.Translation(act_o), parent=body,
                            space="world", bevel=0.008, segments=2)

    # ---- moving stem: local X = world up, origin at the closed coupling center -----
    sb = H.MeshBuilder()
    sb.cylinder((0, 0, zb - 0.03), (0, 0, zc0), 0.006, 12, "mat_steel", M, bw=0.0)
    sb.box((-0.013, -0.011, zc0 - 0.011), (0.013, 0.011, zc0 + 0.011), "mat_dark", M, bw=1.0)
    sb.cylinder((0, 0, zc0), (0, 0, zy + 0.004), 0.0075, 12, "mat_steel", M, bw=0.0)
    stem_o = p + Z * zc0
    stem_m = H.shaft_basis(Z, X, stem_o)
    stem = sb.to_object(scene, "%s_valve_stem" % prefix, matrix=stem_m, parent=body, space="world",
                        bevel=0.0015, segments=1)
    H.set_motion(stem, "translate", (0.0, travel), drive)

    # ---- indicator: L-shaped pointer off the coupling, in front of the scale -------
    ib = H.MeshBuilder()
    ib.box((-0.016, -0.0160, zc0 - 0.0015), (-0.0085, -0.009, zc0 + 0.0015), "mat_actuator", M, bw=0.3)
    ib.box((-0.039, -0.0165, zc0 - 0.0018), (-0.010, -0.0129, zc0 + 0.0018), "mat_actuator", M, bw=0.3)
    ind_o = p + M.to_3x3() @ Vector((-0.024, -0.0147, zc0))
    ind = ib.to_object(scene, "%s_valve_indicator" % prefix, matrix=H.shaft_basis(Z, X, ind_o), parent=body,
                       space="world", bevel=0.0006, segments=1)
    H.set_motion(ind, "translate", (0.0, travel), drive)

    return dict(body=body, actuator=actuator, stem=stem, indicator=ind, gap=(s - gap, s + gap),
                top=p + Z * (hz1 + 0.012), center=p)


def curb(scene, name, x, y, ri, size=0.13, h=0.09, parent=None):
    """Roof penetration: flashed curb with a steel cap and a rubber pipe boot.
    Returns (object, z of the boot top)."""
    mb = H.MeshBuilder()
    s2 = size / 2
    mb.box((x - s2, y - s2, 0.0), (x + s2, y + s2, h), "mat_frame", bw=1.0)
    c2 = s2 + 0.007
    mb.box((x - c2, y - c2, h), (x + c2, y + c2, h + 0.008), "mat_steel", bw=1.0)
    xf = H.basis((0, 0, 1), (1, 0, 0), (0, 1, 0), (x, y, 0.0))
    zt = h + 0.05
    mb.lathe([(h + 0.006, ri + 0.001), (h + 0.006, ri + 0.016), (h + 0.018, ri + 0.016), (zt, ri + 0.005),
              (zt, ri + 0.001)], 20, "mat_dark", xf, bw=0.3)
    obj = mb.to_object(scene, name, matrix=Matrix.Translation((x, y, h / 2)), parent=parent, space="world",
                       bevel=0.004, segments=1)
    return obj, zt
