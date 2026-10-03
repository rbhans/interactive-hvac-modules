"""Hydronic fittings for the water-side modules: pressure gauges with moving
needles, a triple-duty valve with a turning handwheel, a butterfly valve, a
Y-strainer, rubber flex connectors and a magnetic flow meter.

Each fitting sits on a piping.Route at a world point, like piping's own, and
returns its object(s) plus the jacket gap (s_a, s_b) the insulation leaves for
it. Static pieces have identity rotation and their origin on the pipe axis;
moving pieces (needles, handwheels) pivot on their own axis with local X along
it.
"""
import math

from mathutils import Matrix, Vector

import hvaclab as H
from parts import ductwork as D
from parts import piping

SEG = 24


def _flange_pair(mb, M, L, rb, r_fl, t=0.022, mat="mat_steel", bolts=8):
    """Flanges at both ends of a fitting of length L (local X), with bolt heads."""
    for sx in (1, -1):
        x0, x1 = sorted((sx * L / 2, sx * (L / 2 - t)))
        mb.cylinder((x0, 0, 0), (x1, 0, 0), r_fl, SEG, mat, M, bw=0.8)
        for k in range(bolts):
            a = 2 * math.pi * (k + 0.5) / bolts
            y, z = math.cos(a) * (r_fl - 0.016), math.sin(a) * (r_fl - 0.016)
            mb.cylinder((x0 - 0.008, y, z), (x1 + 0.008, y, z), 0.0065, 6, "mat_steel", M, bw=0.0)


def _place(route, point, up=piping.UP):
    s = route.s_of(point)
    M, p = piping.frame(route, s, up)
    _, t = route.locate(s)
    # +1 when the fitting's local X runs downstream
    sign = 1.0 if Vector(M.col[0][:3]).dot(t) >= 0 else -1.0
    return s, M, p, sign


def flex_connector(scene, name, route, point, rb, parent=None):
    """Double-sphere rubber connector between steel flanges: takes up the pump's
    vibration and the pipe's movement."""
    s, M, p, _ = _place(route, point)
    L = 2.4 * rb + 0.05
    gap = L / 2 + piping.INS_CLEAR
    mb = H.MeshBuilder()
    piping._nipple(mb, M, gap, rb)
    _flange_pair(mb, M, L, rb, rb * 1.75 + 0.02)
    a = L / 2 - 0.022
    D.lathe(mb, [(-a, rb * 0.97), (a, rb * 0.97), (a, rb * 1.18), (a * 0.5, rb * 1.52), (0, rb * 1.24),
                 (-a * 0.5, rb * 1.52), (-a, rb * 1.18)], SEG, "mat_dark", M, bw=0.3)
    obj = mb.to_object(scene, name, matrix=Matrix.Translation(p), parent=parent, space="world", bevel=0.0015,
                       segments=1)
    return obj, (s - gap, s + gap)


def butterfly_valve(scene, name, route, point, rb, up=piping.UP, parent=None):
    """Lug butterfly valve with a gear operator and handwheel on a neck toward
    `up` (an isolation valve, left open)."""
    s, M, p, _ = _place(route, point, up)
    L = 0.75 * rb + 0.05
    gap = L / 2 + 0.022 + piping.INS_CLEAR
    mb = H.MeshBuilder()
    piping._nipple(mb, M, gap, rb)
    _flange_pair(mb, M, L + 0.044, rb, rb * 1.75 + 0.02)
    mb.cylinder((-L / 2, 0, 0), (L / 2, 0, 0), rb * 1.6, SEG, "mat_frame", M, bw=0.8)
    zn = rb * 1.6
    mb.cylinder((0, 0, zn - 0.01), (0, 0, zn + 0.09), 0.024, 12, "mat_frame", M, bw=0.4)
    g0 = zn + 0.09
    mb.box((-0.055, -0.045, g0), (0.055, 0.045, g0 + 0.07), "mat_actuator", M, bw=1.0)
    mb.cylinder((0, -0.045, g0 + 0.035), (0, -0.09, g0 + 0.035), 0.008, 8, "mat_steel", M, bw=0.0)
    D.lathe(mb, [(0.0, 0.05), (0.0, 0.058), (0.012, 0.058), (0.012, 0.05)], 20, "mat_dark",
            M @ H.basis((0, -1, 0), (1, 0, 0), (0, 0, 1), (0, -0.09, g0 + 0.035)), bw=0.3)
    obj = mb.to_object(scene, name, matrix=Matrix.Translation(p), parent=parent, space="world", bevel=0.002,
                       segments=1)
    return obj, (s - gap, s + gap)


def y_strainer(scene, name, route, point, rb, parent=None):
    """Flanged Y-strainer: the screen's leg angles down and downstream, with a
    blowdown plug on its cap."""
    s, M, p, sign = _place(route, point)
    L = 4.0 * rb + 0.04
    gap = L / 2 + piping.INS_CLEAR
    mb = H.MeshBuilder()
    piping._nipple(mb, M, gap, rb)
    _flange_pair(mb, M, L, rb, rb * 1.75 + 0.02)
    a = L / 2 - 0.022
    D.lathe(mb, [(-a, rb * 0.97), (a, rb * 0.97), (a, rb * 1.15), (a * 0.4, rb * 1.3), (-a * 0.4, rb * 1.3),
                 (-a, rb * 1.15)], SEG, "mat_valve", M, bw=0.5)
    d = Vector((0.7071 * sign, 0.0, -0.7071))
    c0 = Vector((-0.2 * rb * sign, 0, 0))
    leg = rb * 2.6
    mb.cylinder(c0, c0 + d * leg, rb * 0.95, SEG, "mat_valve", M, bw=0.5)
    mb.cylinder(c0 + d * leg, c0 + d * (leg + 0.03), rb * 1.18, SEG, "mat_valve", M, bw=0.8)
    mb.cylinder(c0 + d * (leg + 0.03), c0 + d * (leg + 0.05), 0.016, 6, "mat_steel", M, bw=0.5)
    obj = mb.to_object(scene, name, matrix=Matrix.Translation(p), parent=parent, space="world", bevel=0.002,
                       segments=1)
    return obj, (s - gap, s + gap)


def triple_duty_valve(scene, name, route, point, rb, drive, turns=540.0, face=piping.FRONT, parent=None):
    """Triple-duty valve (shutoff, check and balancing in one body): a globe-like
    body with its bonnet toward `face` and a handwheel `<name>_handwheel` that
    turns with `drive` (0 = wide open, 1 = shut). Returns (body, handwheel, gap)."""
    s, M, p, _ = _place(route, point, face)
    L = 4.6 * rb + 0.05
    gap = L / 2 + piping.INS_CLEAR
    mb = H.MeshBuilder()
    piping._nipple(mb, M, gap, rb)
    _flange_pair(mb, M, L, rb, rb * 1.75 + 0.02, mat="mat_frame")
    a = L / 2 - 0.022
    D.lathe(mb, [(-a, rb * 0.97), (a, rb * 0.97), (a, rb * 1.2), (a * 0.55, rb * 1.75), (0, rb * 1.95),
                 (-a * 0.55, rb * 1.75), (-a, rb * 1.2)], SEG, "mat_frame", M, bw=0.6)
    # bonnet, packing and stem toward the face
    z0 = rb * 1.7
    mb.cylinder((0, 0, z0), (0, 0, z0 + rb * 1.1), rb * 0.8, SEG, "mat_frame", M, bw=0.8)
    mb.cylinder((0, 0, z0 + rb * 1.1), (0, 0, z0 + rb * 1.1 + 0.03), rb * 0.45, 6, "mat_valve", M, bw=0.6)
    zs = z0 + rb * 1.1 + 0.03
    # the stem stops at the handwheel's hub
    mb.cylinder((0, 0, zs), (0, 0, zs + 0.0285), 0.011, 10, "mat_steel", M, bw=0.0)
    # memory-stop scale on the bonnet
    mb.box((-0.004, rb * 0.79, z0 + 0.01), (0.004, rb * 0.82, z0 + rb * 1.05), "mat_accent", M, bw=0.1)
    body = mb.to_object(scene, name, matrix=Matrix.Translation(p), parent=parent, space="world", bevel=0.002,
                        segments=1)
    # handwheel: rim, hub and three spokes; local X = the stem (toward the face)
    zw = zs + 0.045
    wx = Vector(M.col[2][:3]).normalized()
    wy = Vector(M.col[0][:3]).normalized()
    W = H.shaft_basis(wx, wy, M @ Vector((0, 0, zw)))
    R, rr = rb * 1.35 + 0.02, 0.009
    wb = H.MeshBuilder()
    D.lathe(wb, [(rr * math.cos(t), R + rr * math.sin(t)) for t in (k * math.pi / 4 for k in range(8))], 32,
            "mat_actuator", bw=0.0)
    wb.cylinder((-0.016, 0, 0), (0.016, 0, 0), 0.02, 12, "mat_actuator", bw=0.6)
    for k in range(3):
        ang = 2 * math.pi * k / 3
        u = Vector((0, math.cos(ang), math.sin(ang)))
        wb.cylinder(u * 0.015, u * (R - 0.004), 0.0055, 8, "mat_actuator", bw=0.0)
    # a knob on the rim so the turning reads
    wb.cylinder((0.0, 0, R), (0.03, 0, R), 0.009, 8, "mat_dark", bw=0.5)
    wheel = wb.to_object(scene, name + "_handwheel", matrix=W, parent=body, bevel=0.0015, segments=1)
    H.set_motion(wheel, "rotate", (0.0, -turns), drive)
    return body, wheel, (s - gap, s + gap)


def mag_meter(scene, name, route, point, rb, display=(0.0, -1.0, 0.0), parent=None):
    """Magnetic flow meter: a flanged spool with a transmitter head on a neck
    above it, its display facing `display` (world)."""
    s, M, p, _ = _place(route, point)
    L = 3.2 * rb + 0.05
    gap = L / 2 + piping.INS_CLEAR
    mb = H.MeshBuilder()
    piping._nipple(mb, M, gap, rb)
    _flange_pair(mb, M, L, rb, rb * 1.75 + 0.02)
    a = L / 2 - 0.022
    D.lathe(mb, [(-a, rb * 0.97), (a, rb * 0.97), (a, rb * 1.42), (-a, rb * 1.42)], SEG, "mat_frame", M, bw=0.8)
    z0 = rb * 1.42
    mb.cylinder((0, 0, z0 - 0.005), (0, 0, z0 + 0.06), 0.028, 12, "mat_frame", M, bw=0.5)
    obj = mb.to_object(scene, name, matrix=Matrix.Translation(p), parent=parent, space="world", bevel=0.002,
                       segments=1)
    # transmitter head, world-aligned above the pipe
    up = Vector(M.col[2][:3]).normalized()
    c = p + up * (z0 + 0.06 + 0.055)
    f = Vector(display).normalized()
    side = up.cross(f).normalized()
    hb = H.MeshBuilder()
    B = H.basis(side, f, up, c)
    hb.box((-0.07, -0.055, -0.055), (0.07, 0.055, 0.055), "mat_housing", B, bw=1.0)
    hb.box((-0.05, 0.055, -0.03), (0.05, 0.0565, 0.035), "mat_dark", B, bw=0.1)
    hb.box((-0.04, 0.0565, 0.0), (0.0, 0.0575, 0.02), "mat_accent", B, bw=0.1)
    hb.cylinder((0.07, 0.0, -0.02), (0.09, 0.0, -0.02), 0.01, 8, "mat_dark", B, bw=0.3)
    hb.to_object(scene, name + "_head", matrix=Matrix.Translation(c), parent=obj, space="world", bevel=0.006,
                 segments=2)
    return obj, (s - gap, s + gap)


def gauge(scene, name, base, normal, rb, drive, dial_r=0.045, stem=0.07, face=(0.0, -1.0, 0.0), up=(0.0, 0.0, 1.0),
          parent=None):
    """Pressure gauge on a pipe: a brass stem from `base` (on the pipe's axis)
    out along `normal`, a cock, and a dial facing `face`. Its needle
    `<name>_needle` sweeps clockwise from 7:30 to 4:30 as `drive` goes 0 to 1.
    Returns (gauge, needle)."""
    base, n, f, u = Vector(base), Vector(normal).normalized(), Vector(face).normalized(), Vector(up).normalized()
    mb = H.MeshBuilder()
    s0 = base + n * (rb * 0.9)
    end = s0 + n * stem
    mb.cylinder(s0, end, 0.007, 10, "mat_valve", bw=0.0)
    mb.cylinder(s0 + n * 0.02, s0 + n * 0.036, 0.012, 6, "mat_valve", bw=0.5)
    # a gauge cock with a little lever
    mb.cylinder(s0 + n * 0.045, s0 + n * 0.058, 0.01, 8, "mat_valve", bw=0.5)
    if abs(n.dot(f)) > 0.7:
        c = end + f * 0.014          # stem runs into the back of the case
    else:
        c = end + n * dial_r         # stem runs into the bottom of the case
    mb.cylinder(c - f * 0.014, c + f * 0.012, dial_r, 28, "mat_steel", bw=1.0)
    mb.cylinder(c + f * 0.011, c + f * 0.0135, dial_r - 0.005, 28, "mat_accent", bw=0.0)
    side = f.cross(u)
    for k in range(7):
        ang = math.radians(135 - 45 * k)
        d = u * math.cos(ang) + side * math.sin(ang)
        p0 = c + f * 0.013 + d * (dial_r * 0.72)
        mb.cylinder(p0, p0 + f * 0.0012, 0.0022 if k % 3 == 0 else 0.0015, 6, "mat_dark", bw=0.0)
    # a red band where the scale tops out
    obj = mb.to_object(scene, name, matrix=Matrix.Translation(c), parent=parent, space="world", bevel=0.0012,
                       segments=1)
    # the needle rides just above the face and its tick dots
    N = H.shaft_basis(f, u, c + f * 0.0148)
    nb = H.MeshBuilder()
    nb.box((0.0, -0.008, -0.0016), (0.0016, dial_r * 0.78, 0.0016), "mat_dark", bw=0.0)
    nb.cylinder((0.0004, 0, 0), (0.0032, 0, 0), 0.0045, 10, "mat_dark", bw=0.0)
    needle = nb.to_object(scene, name + "_needle", matrix=N, parent=obj, bevel=0.0)
    H.set_motion(needle, "rotate", (135.0, -135.0), drive)
    return obj, needle


def three_way_valve(scene, prefix, route, point, rb, drive, port_len=0.07, parent=None):
    """Three-way mixing valve: piping's globe control valve and actuator with a
    third port out the bottom of the body for the bypass. Returns the control
    valve's dict plus `port` (world point at the bottom port's flange face)."""
    cv = piping.control_valve(scene, prefix, route, point, rb, drive, parent=parent)
    p = cv["center"]
    mb = H.MeshBuilder()
    z0, z1 = p.z - rb * 1.4, p.z - rb * 2.4 - port_len
    mb.cylinder((p.x, p.y, z0), (p.x, p.y, z1 + 0.013), rb * 1.05, SEG, "mat_valve", bw=0.6)
    mb.cylinder((p.x, p.y, z1 + 0.013), (p.x, p.y, z1), rb * 2.6, 20, "mat_valve", bw=1.0)
    for k in range(4):
        ang = math.pi / 4 + k * math.pi / 2
        x, y = p.x + rb * 2.0 * math.cos(ang), p.y + rb * 2.0 * math.sin(ang)
        mb.cylinder((x, y, z1 - 0.006), (x, y, z1 + 0.018), 0.0038, 6, "mat_steel", bw=0.0)
    mb.to_object(scene, prefix + "_valve_port", matrix=Matrix.Translation((p.x, p.y, (z0 + z1) / 2)), parent=cv["body"],
                 space="world", bevel=0.0015, segments=1)
    cv["port"] = Vector((p.x, p.y, z1))
    return cv


def dp_transmitter(scene, name, at, taps, parent=None):
    """Differential pressure transmitter: a small housing at `at` with two
    impulse tubes to the pipe taps `taps` (world points, high side first)."""
    at = Vector(at)
    mb = H.MeshBuilder()
    mb.box(at + Vector((-0.05, -0.035, -0.06)), at + Vector((0.05, 0.035, 0.06)), "mat_housing", bw=1.0)
    mb.box(at + Vector((-0.035, -0.0365, 0.0)), at + Vector((0.035, -0.035, 0.045)), "mat_dark", bw=0.1)
    mb.box(at + Vector((-0.028, -0.0375, 0.012)), at + Vector((0.0, -0.0365, 0.03)), "mat_accent", bw=0.1)
    for k, tap in enumerate(taps):
        tap = Vector(tap)
        sx = -0.025 if k == 0 else 0.025
        a = at + Vector((sx, 0.0, -0.06))
        rt = piping.Route([a, Vector((a.x, a.y, a.z - 0.08)), Vector((tap.x, a.y, a.z - 0.08)), Vector((tap.x, tap.y, a.z - 0.08)),
                           tap], 0.03)
        mb.tube(rt.pts, 0.004, 8, "mat_valve", bw=0.0)
        mb.cylinder(tap + Vector((0, 0, 0.0)), tap + Vector((0, 0, 0.018)), 0.008, 6, "mat_valve", bw=0.5)
    return mb.to_object(scene, name, matrix=Matrix.Translation(at), parent=parent, space="world", bevel=0.004,
                        segments=1)
