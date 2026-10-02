"""Plug (plenum) fan: backward-curved wheel, inlet bellmouth on a bulkhead,
motor and base. The wheel axis is world X; the inlet faces -X."""
import math

from mathutils import Matrix, Vector

import hvaclab as H


def _interp(pts, r):
    """x at radius r along a (x, r) polyline with increasing r."""
    for (x0, r0), (x1, r1) in zip(pts, pts[1:]):
        if r0 <= r <= r1:
            t = (r - r0) / (r1 - r0) if r1 != r0 else 0.0
            return x0 + (x1 - x0) * t
    return pts[0][0] if r < pts[0][1] else pts[-1][0]


def wheel(scene, name, center, diameter=0.6, width=0.2, blades=10, parent=None,
          drives="fanSpeed", rate=540.0, mat="mat_dark"):
    R = diameter / 2
    w2 = width / 2
    mb = H.MeshBuilder()
    # backplate (annulus) + hub
    bp0 = w2 - 0.008
    mb.lathe([(bp0, 0.04), (w2, 0.04), (w2, R), (bp0, R)], 32, mat, bw=0.8)
    mb.cylinder((0.04, 0, 0), (w2 + 0.035, 0, 0), 0.045, 20, mat, bw=1.0)
    # shroud: curved cone from the inlet eye (-X) to the rim
    k = R / 0.3
    S = [(-w2, 0.197 * k), (-w2 + 0.006, 0.222 * k), (-w2 + 0.022, 0.250 * k),
         (-w2 + 0.046, 0.278 * k), (-w2 + 0.074, 0.300 * k)]
    st = 0.005
    inner = [(x + st, r) for x, r in S]
    mb.lathe(S + list(reversed(inner)), 32, mat, bw=0.8)
    # backward-curved blades (log spiral, blade angle ~35 deg)
    r1, r2 = 0.205 * k, 0.296 * k
    kk = math.tan(math.radians(35))
    nb = 5
    half_t = 0.002
    for b in range(blades):
        phi0 = 2 * math.pi * b / blades
        pts = []
        for i in range(nb):
            r = r1 + (r2 - r1) * i / (nb - 1)
            phi = phi0 - math.log(r / r1) / kk
            pts.append((r, Vector((r * math.cos(phi), r * math.sin(phi)))))
        rows = []
        for i, (r, P) in enumerate(pts):
            if i == 0:
                t = pts[1][1] - pts[0][1]
            elif i == nb - 1:
                t = pts[-1][1] - pts[-2][1]
            else:
                t = pts[i + 1][1] - pts[i - 1][1]
            t.normalize()
            n = Vector((-t.y, t.x)) * half_t
            xf_ = _interp(inner, r) - 0.002
            xb_ = bp0 + 0.002
            a, c = P + n, P - n
            rows.append([(xf_, a.x, a.y), (xb_, a.x, a.y), (xb_, c.x, c.y), (xf_, c.x, c.y)])
        mb.solid_strip(rows, mat, bw=0.0)
    obj = mb.to_object(scene, name, matrix=Matrix.Translation(Vector(center)), parent=parent, bevel=0.0015, segments=1)
    H.set_motion(obj, "spin", (0.0, rate), drives)
    return obj


def inlet(scene, name, center, wall_x, throat=0.178, overlap_x=0.782, parent=None):
    """Bellmouth (lathe) mounted on the bulkhead face at wall_x."""
    C = Vector(center)
    B = [(wall_x + 0.011, 0.268), (wall_x + 0.016, 0.238), (wall_x + 0.030, 0.214),
         (wall_x + 0.060, 0.195), (wall_x + 0.110, throat + 0.005), (overlap_x, throat)]
    B = [(x - C.x, r) for x, r in B]
    off = H.offset_curve_2d(B, 0.004)
    xf = Matrix.Translation(C)
    mb = H.MeshBuilder()
    mb.lathe(B + list(reversed(off)), 28, "mat_duct", bw=0.6)
    fx = wall_x + 0.01 - C.x
    mb.lathe([(fx, 0.262), (fx + 0.004, 0.262), (fx + 0.004, 0.302), (fx, 0.302)], 28, "mat_duct", bw=0.6)
    return mb.to_object(scene, name, matrix=xf, parent=parent, bevel=0.0012, segments=1)


def wall(scene, name, x, y0, y1, z0, z1, hole_center, hole_r, thickness=0.02, parent=None):
    xf = H.basis((0, 1, 0), (0, 0, 1), (1, 0, 0), (x, (y0 + y1) / 2, (z0 + z1) / 2))
    cy, cz = hole_center
    mb = H.MeshBuilder()
    mb.plate((y0 - (y0 + y1) / 2, y1 - (y0 + y1) / 2, z0 - (z0 + z1) / 2, z1 - (z0 + z1) / 2), thickness,
             "mat_liner", xf, hole=("circle", cy - (y0 + y1) / 2, cz - (z0 + z1) / 2, hole_r, 32))
    return mb.to_object(scene, name, matrix=Matrix.Translation(Vector((x, (y0 + y1) / 2, (z0 + z1) / 2))),
                        parent=parent, space="world", bevel=0.003)


def motor(scene, name, axis_y, axis_z, x0=0.985, x1=1.33, radius=0.105, shaft_from=0.93, parent=None):
    mb = H.MeshBuilder()
    a = lambda x: (x, axis_y, axis_z)
    mb.cylinder(a(shaft_from), a(x0 + 0.002), 0.016, 12, "mat_steel", bw=0.0)
    mb.cylinder(a(x0), a(x0 + 0.018), radius - 0.01, 24, "mat_steel", bw=0.8)
    body0, body1 = x0 + 0.015, x1 - 0.07
    mb.cylinder(a(body0), a(body1), radius, 24, "mat_frame", bw=1.0)
    # cooling ribs
    for i in range(3):
        xr = body0 + 0.05 + i * (body1 - body0 - 0.1) / 2
        mb.cylinder(a(xr - 0.005), a(xr + 0.005), radius + 0.006, 24, "mat_frame", bw=0.0)
    mb.cylinder(a(body1 - 0.003), a(body1 + 0.02), radius - 0.01, 24, "mat_steel", bw=0.8)
    mb.cylinder(a(body1 + 0.018), a(x1), radius - 0.004, 24, "mat_frame", bw=1.0)
    # terminal box + feet
    xm = (body0 + body1) / 2
    mb.box((xm - 0.05, axis_y - 0.045, axis_z + radius - 0.012), (xm + 0.05, axis_y + 0.045, axis_z + radius + 0.045),
           "mat_frame", bw=0.8)
    for fx in (body0 + 0.03, body1 - 0.07):
        mb.box((fx, axis_y - 0.085, axis_z - radius - 0.012), (fx + 0.04, axis_y + 0.085, axis_z - radius + 0.03),
               "mat_frame", bw=0.8)
    ctr = Vector(((x0 + x1) / 2, axis_y, axis_z))
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world", bevel=0.003,
                        segments=1)


def base(scene, name, x0, x1, floor_z, top_z, ped_x0, ped_x1, parent=None):
    """Skid rails on isolators with a pedestal carrying the motor."""
    mb = H.MeshBuilder()
    z = floor_z
    for sy in (1, -1):
        y0, y1 = sorted((sy * 0.14, sy * 0.18))
        mb.box((x0, y0, z), (x1, y1, z + 0.039), "mat_frame")               # lower rail
        mb.box((x0, y0, z + 0.069), (x1, y1, z + 0.099), "mat_frame")       # upper rail
        for ix in (x0 + 0.06, x1 - 0.06):
            mb.cylinder((ix, sy * 0.16, z + 0.039), (ix, sy * 0.16, z + 0.069), 0.022, 12, "mat_dark", bw=0.0)
    for cx in (ped_x0, ped_x1 - 0.04):
        mb.box((cx, -0.185, z + 0.099), (cx + 0.04, 0.185, z + 0.125), "mat_frame")    # cross members on the rails
    zt = z + 0.125
    # pedestal
    for sy in (1, -1):
        y0, y1 = sorted((sy * 0.1, sy * 0.112))
        mb.box((ped_x0, y0, zt), (ped_x1, y1, top_z - 0.015), "mat_steel")
    for px in (ped_x0, ped_x1 - 0.012):
        mb.box((px, -0.1, zt), (px + 0.012, 0.1, top_z - 0.015), "mat_steel")
    mb.box((ped_x0 - 0.01, -0.125, top_z - 0.015), (ped_x1 + 0.01, 0.125, top_z), "mat_steel")
    ctr = Vector(((x0 + x1) / 2, 0.0, (floor_z + top_z) / 2))
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world", bevel=0.003,
                        segments=1)
