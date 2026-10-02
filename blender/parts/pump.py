"""Base-mounted end-suction pump (close-coupled look on a baseplate): volute
casing, impeller, bearing frame, coupling guard and motor, on a steel
baseplate.

World axes: the shaft runs along +X at (y = 0, z = zs). Water comes in
axially from -X through the suction nozzle into the impeller's eye and leaves
straight up through the discharge nozzle on top of the casing. The casing is
two half-shells: the back half (+Y) is static, the front half (`<prefix>_casing_front`)
is the cutaway panel, so the impeller shows spinning inside.
"""
import math

from mathutils import Matrix, Vector

import hvaclab as H
from parts import ductwork as D
from parts import fan

SEG = 32


def end_suction(scene, prefix, cx, zs, base_z, r_suc, r_dis, R=0.23, W=0.15, parent=None, drive="pumpSpeed",
                rate=900.0):
    """cx: casing center x; zs: shaft height; base_z: top of the pad the
    baseplate sits on; r_suc / r_dis: suction and discharge bores. Returns a
    dict of the key points (suction flange x, discharge flange top z, ...)."""
    asm = H.assembly(scene, prefix, (cx, 0.0, zs), parent=parent, explode=(0.0, -0.8, 0.0))
    xa, xb = cx - W / 2, cx + W / 2
    t = 0.014
    axis = Matrix.Translation((0.0, 0.0, zs))
    out = {}

    def shell(mb, a0, a1):
        D.arc_ring(mb, xa, xb, R - t, R, a0, a1, 24, "mat_pump", axis, bw=0.6)
        D.arc_ring(mb, xa, xa + t, r_suc, R - t, a0, a1, 24, "mat_pump", axis, bw=0.6)
        D.arc_ring(mb, xb - t, xb, 0.035, R - t, a0, a1, 24, "mat_pump", axis, bw=0.6)

    # back half (+Y) with the nozzles, the cover and the bearing frame
    mb = H.MeshBuilder()
    shell(mb, -90.0, 90.0)
    # suction nozzle and flange (-X)
    xs1 = xa - 0.13
    D.tube_wall(mb, xs1 + 0.022, xa + 0.004, r_suc, r_suc + 0.009, SEG, "mat_pump", axis, bw=0.6)
    D.tube_wall(mb, xs1, xs1 + 0.022, r_suc, r_suc * 1.75 + 0.02, SEG, "mat_pump", axis, bw=0.8)
    out["suction_x"] = xs1
    # discharge nozzle and flange (top)
    zt = zs + R + 0.14
    up = D.up_frame(cx, 0.0)
    D.tube_wall(mb, zs + R - 0.03, zt - 0.022, r_dis, r_dis + 0.009, SEG, "mat_pump", up, bw=0.6)
    D.tube_wall(mb, zt - 0.022, zt, r_dis, r_dis * 1.75 + 0.02, SEG, "mat_pump", up, bw=0.8)
    out["discharge_z"] = zt
    # casing feet
    for sy in (1, -1):
        y0, y1 = sorted((sy * 0.06, sy * 0.15))
        mb.box((cx - 0.05, y0, base_z + 0.06), (cx + 0.05, y1, zs - R + 0.03), "mat_pump", bw=0.8)
    # back cover, stuffing box and bearing frame out to the coupling
    xc0, xc1 = xb, xb + 0.05
    mb.cylinder((xc0, 0, zs), (xc1, 0, zs), 0.15, SEG, "mat_pump", bw=0.8)
    xf0, xf1 = xc1, cx + 0.42
    mb.cylinder((xf0, 0, zs), (xf1, 0, zs), 0.075, SEG, "mat_pump", bw=0.8)
    mb.box((xf0 + 0.06, -0.09, base_z + 0.06), (xf1 - 0.04, 0.09, zs - 0.06), "mat_pump", bw=0.8)
    out["frame_end"] = xf1
    mb.to_object(scene, prefix + "_casing", matrix=Matrix.Translation((cx, 0.0, zs)), parent=asm, space="world",
                 bevel=0.003, segments=1)

    # front half: the cutaway
    fb = H.MeshBuilder()
    shell(fb, 90.0, 270.0)
    front = fb.to_object(scene, prefix + "_casing_front", matrix=Matrix.Translation((cx, -R / 2, zs)), parent=asm,
                         space="world", bevel=0.003, segments=1)
    H.set_cutaway(front)
    H.set_explode(front, (0.0, -0.5, 0.0))

    # impeller: a closed, backward-curved impeller (the fan wheel's construction), eye toward the suction
    fan.wheel(scene, prefix + "_impeller", (cx - 0.005, 0.0, zs), diameter=2 * (R - t) - 0.05, width=W - 2 * t - 0.03,
              blades=7, parent=asm, drives=drive, rate=rate, mat="mat_valve")
    # shaft from the impeller hub through the frame to the coupling
    sb = H.MeshBuilder()
    xm0 = xf1 + 0.17
    sb.cylinder((cx + 0.03, 0, zs), (xm0 + 0.02, 0, zs), 0.022, 16, "mat_steel", bw=0.0)
    sb.to_object(scene, prefix + "_shaft", matrix=Matrix.Translation(((cx + xm0) / 2, 0.0, zs)), parent=asm,
                 space="world")
    # coupling guard
    gb = H.MeshBuilder()
    gb.box((xf1, -0.1, zs - 0.11), (xm0, 0.1, zs + 0.12), "mat_housing", bw=1.0)
    for k in range(3):
        xg = xf1 + 0.04 + k * 0.045
        gb.box((xg, -0.1012, zs - 0.06), (xg + 0.012, -0.0995, zs + 0.07), "mat_dark", bw=0.0)
    gb.to_object(scene, prefix + "_coupling_guard", matrix=Matrix.Translation(((xf1 + xm0) / 2, 0.0, zs)),
                 parent=asm, space="world", bevel=0.006, segments=2)
    # motor on a pedestal
    mr = 0.15
    xm1 = xm0 + 0.56
    fan.motor(scene, prefix + "_motor", 0.0, zs, x0=xm0, x1=xm1, radius=mr, shaft_from=xm0 - 0.03, parent=asm)
    pb = H.MeshBuilder()
    pb.box((xm0 + 0.03, -0.12, base_z + 0.06), (xm1 - 0.06, 0.12, zs - mr - 0.012), "mat_frame", bw=0.8)
    pb.to_object(scene, prefix + "_motor_base", matrix=Matrix.Translation(((xm0 + xm1) / 2, 0.0, base_z + 0.1)),
                 parent=asm, space="world", bevel=0.003, segments=1)
    out["motor"] = (xm0, xm1, mr)
    # baseplate: two channels and cross members
    bb = H.MeshBuilder()
    x0, x1 = xs1 + 0.05, xm1 + 0.04
    for sy in (1, -1):
        y0, y1 = sorted((sy * 0.17, sy * 0.24))
        bb.box((x0, y0, base_z), (x1, y1, base_z + 0.06), "mat_frame", bw=0.8)
    for xx in (x0, (x0 + x1) / 2 - 0.02, x1 - 0.04):
        bb.box((xx, -0.17, base_z), (xx + 0.04, 0.17, base_z + 0.06), "mat_frame", bw=0.8)
    bb.to_object(scene, prefix + "_baseplate", matrix=Matrix.Translation(((x0 + x1) / 2, 0.0, base_z + 0.03)),
                 parent=asm, space="world", bevel=0.003, segments=1)
    out["base"] = (x0, x1)
    out["assembly"] = asm
    return out
