"""Pumps & VFDs teaching module: a chilled-water pump in a mechanical room, cut
like a section model (front and sides open, the back wall standing).

Layout (Blender Z-up, meters, front = -Y; the shaft runs along X at y = 0):

  back wall (y = 1.5) with the two pipes through it at z = 2.35
  suction (5"): in through the wall at x = -1.8, down past a butterfly valve,
    then +X along the floor: Y-strainer, pressure gauge, flex connector, into the
    pump's suction nozzle
  pump: base-mounted end-suction on a housekeeping pad, casing at x = -0.45,
    motor to +X; the casing's front half is the cutaway over the impeller
  discharge (4"): straight up off the casing: flex connector, pressure gauge,
    triple-duty valve (handwheel to the front), then back along the ceiling
    through a magnetic flow meter and out through the wall
  the pump's VFD on the back wall, conduit over to the motor
"""
from mathutils import Matrix, Vector

import hvaclab as H
from parts import ductwork as D
from parts import hydronic, piping, pump, room

DRIVES = ["pumpSpeed", "valveTravel", "suctionGauge", "dischargeGauge"]
SEG = 24

# ---- room ---------------------------------------------------------------------
FX0, FX1 = -2.5, 2.1
FY0, FY1 = -1.5, 1.5
WALL_T, WALL_TOP, SLAB_T = 0.15, 3.0, 0.15
PAD_X0, PAD_X1, PAD_Y, PAD_H = -1.08, 1.0, 0.42, 0.1

# ---- pump ---------------------------------------------------------------------
CX, ZS, R = -0.45, 0.52, 0.23

# ---- piping -------------------------------------------------------------------
RB_S, RI_S = 0.0705, 0.105      # 5" suction: bare pipe / insulation radius
RB_D, RI_D = 0.057, 0.09        # 4" discharge
Z_TOP = 2.35                    # overhead runs
X_SUC = -1.8                    # suction drop
FLANGE_T = 0.022

REQUIRE = [
    "floor_slab", "pad", "wall_back",
    "pump", "pump_casing", "pump_casing_front", "pump_impeller", "pump_motor", "pump_baseplate",
    "suction_pipe", "discharge_pipe", "suction_strainer", "suction_valve", "suction_flex", "discharge_flex",
    "tdv", "tdv_handwheel", "flow_meter", "suction_gauge", "suction_gauge_needle", "discharge_gauge",
    "discharge_gauge_needle", "vfd",
    "anchor_pump", "anchor_meter", "anchor_valve", "anchor_gauges", "anchor_strainer", "anchor_vfd",
    "flow_suc_00", "flow_dis_00",
]


def build_room(scene):
    cut = D.CUT
    mb = H.MeshBuilder()
    D.box6(mb, (FX0, FY0, -SLAB_T), (FX1, FY1, 0.0), {"-y": cut, "+x": cut, "-x": cut, "-z": cut}, "mat_concrete",
           bw=0.4)
    mb.to_object(scene, "floor_slab", matrix=Matrix.Translation(((FX0 + FX1) / 2, 0.0, -SLAB_T / 2)), space="world",
                 bevel=0.003, segments=1)
    pb = H.MeshBuilder()
    pb.box((PAD_X0, -PAD_Y, 0.0), (PAD_X1, PAD_Y, PAD_H), "mat_concrete", bw=1.0)
    pb.to_object(scene, "pad", matrix=Matrix.Translation(((PAD_X0 + PAD_X1) / 2, 0.0, PAD_H / 2)), space="world",
                 bevel=0.012, segments=2)
    room.wall(scene, "wall_back", [
        ((FX0, FY1, -SLAB_T), (FX1, FY1 + WALL_T, WALL_TOP), {"+x": cut, "-x": cut, "+z": cut, "-z": cut}),
    ])


def _mating_flange(mb, center, axis, rb):
    """Pipe-side flange against a pump nozzle, `axis` pointing away from the pump."""
    a = Vector(axis).normalized()
    c = Vector(center)
    mb.cylinder(c, c + a * FLANGE_T, rb * 1.75 + 0.02, SEG, "mat_steel", bw=0.8)


def _sleeve(mb, x, z, ri):
    """Wall sleeve and escutcheon where a pipe goes through the back wall."""
    xf = H.basis((0, 1, 0), (0, 0, 1), (1, 0, 0), (x, 0.0, z))
    D.lathe(mb, [(FY1 - 0.012, ri + 0.004), (FY1, ri + 0.004), (FY1, ri + 0.04), (FY1 - 0.012, ri + 0.04)], SEG,
            "mat_steel", xf, bw=0.5)


def build_piping(scene, p):
    out = {}
    # ── suction: wall → down → along the floor → pump ──
    xs = p["suction_x"] - FLANGE_T
    suc = piping.Route([(X_SUC, FY1, Z_TOP), (X_SUC, 0.0, Z_TOP), (X_SUC, 0.0, ZS), (xs, 0.0, ZS)], 0.24)
    bv, g1 = hydronic.butterfly_valve(scene, "suction_valve", suc, (X_SUC, 0.0, 1.5), RB_S, up=piping.FRONT)
    st, g2 = hydronic.y_strainer(scene, "suction_strainer", suc, (-1.33, 0.0, ZS), RB_S)
    fx_s = xs - (2.4 * RB_S + 0.05) / 2
    fl, g3 = hydronic.flex_connector(scene, "suction_flex", suc, (fx_s, 0.0, ZS), RB_S)
    hydronic.gauge(scene, "suction_gauge", (-0.99, 0.0, ZS), (0, 0, 1), RB_S, "suctionGauge",
                   stem=RI_S - 0.9 * RB_S + 0.05)
    s_wall = 0.03
    s_end = g3[0]
    piping.jacket(scene, "suction_pipe", suc, RI_S, gaps=[g1, g2], s0=s_wall, s1=s_end, seg=24)
    out["suc"] = (suc, s_wall, suc.length)

    # ── discharge: pump → up → back along the ceiling → wall ──
    zd = p["discharge_z"] + FLANGE_T
    dis = piping.Route([(CX, 0.0, zd), (CX, 0.0, Z_TOP), (CX, FY1, Z_TOP)], 0.2)
    fz = zd + (2.4 * RB_D + 0.05) / 2
    fd, h1 = hydronic.flex_connector(scene, "discharge_flex", dis, (CX, 0.0, fz), RB_D)
    tdv, wheel, h2 = hydronic.triple_duty_valve(scene, "tdv", dis, (CX, 0.0, 1.52), RB_D, "valveTravel")
    fm, h3 = hydronic.mag_meter(scene, "flow_meter", dis, (CX, 0.75, Z_TOP), RB_D, display=(-1.0, 0.0, 0.0))
    hydronic.gauge(scene, "discharge_gauge", (CX, 0.0, 1.2), (0, -1, 0), RB_D, "dischargeGauge",
                   stem=RI_D - 0.9 * RB_D + 0.05)
    piping.jacket(scene, "discharge_pipe", dis, RI_D, gaps=[h2, h3], s0=h1[1], s1=dis.length - 0.03, seg=24)
    out["dis"] = (dis, 0.0, dis.length - 0.03)

    # mating flanges at the pump, sleeves at the wall
    mb = H.MeshBuilder()
    _mating_flange(mb, (p["suction_x"], 0.0, ZS), (-1, 0, 0), RB_S)
    _mating_flange(mb, (CX, 0.0, p["discharge_z"]), (0, 0, 1), RB_D)
    _sleeve(mb, X_SUC, Z_TOP, RI_S)
    _sleeve(mb, CX, Z_TOP, RI_D)
    # supports: a hanger rod and band on each overhead run, a floor stand under the suction
    for x, ri in ((X_SUC, RI_S), (CX, RI_D)):
        y = 0.95
        mb.cylinder((x, y, Z_TOP + ri + 0.004), (x, y, WALL_TOP), 0.006, 8, "mat_steel", bw=0.0)
        xf = H.basis((0, 1, 0), (0, 0, 1), (1, 0, 0), (x, 0.0, Z_TOP))
        D.lathe(mb, [(y - 0.02, ri + 0.001), (y + 0.02, ri + 0.001), (y + 0.02, ri + 0.008), (y - 0.02, ri + 0.008)],
                SEG, "mat_steel", xf, bw=0.4)
    xst = -1.66
    mb.cylinder((xst, 0.0, 0.012), (xst, 0.0, ZS - RI_S - 0.025), 0.02, 12, "mat_steel", bw=0.4)
    mb.box((xst - 0.08, -0.08, 0.0), (xst + 0.08, 0.08, 0.012), "mat_steel", bw=0.6)
    mb.box((xst - 0.05, -RI_S - 0.01, ZS - RI_S - 0.025), (xst + 0.05, RI_S + 0.01, ZS - RI_S - 0.001), "mat_steel",
           bw=0.6)
    mb.to_object(scene, "pipe_supports", matrix=Matrix.Translation((-1.0, 0.5, 1.2)), space="world", bevel=0.002,
                 segments=1)
    return out


def build_vfd(scene, p):
    """The pump's drive on the back wall, conduit over to the motor's terminal box."""
    x0, x1, z0, z1 = 0.62, 1.12, 1.0, 1.78
    y0, y1 = FY1 - 0.22, FY1 - 0.001
    mb = H.MeshBuilder()
    mb.box((x0, y0, z0), (x1, y1, z1), "mat_housing", bw=1.0)
    fy = y0 - 0.0012
    mb.box((x0 + 0.04, fy, z1 - 0.24), (x1 - 0.04, y0 + 0.001, z1 - 0.05), "mat_frame", bw=0.2)
    mb.box((x0 + 0.09, fy - 0.001, z1 - 0.19), (x1 - 0.09, y0 + 0.0005, z1 - 0.1), "mat_dark", bw=0.1)
    mb.box((x0 + 0.11, fy - 0.0018, z1 - 0.17), (x0 + 0.26, fy - 0.0008, z1 - 0.135), "mat_accent", bw=0.1)
    for k in range(5):
        mb.box((x0 + 0.05, fy, z0 + 0.12 + 0.05 * k), (x1 - 0.05, y0 + 0.001, z0 + 0.137 + 0.05 * k), "mat_frame",
               bw=0.0)
    xm0, xm1, mr = p["motor"]
    xt = (xm0 + xm1) / 2
    zt = ZS + mr + 0.045
    cx = (x0 + x1) / 2
    rt = piping.Route([(cx, FY1 - 0.08, z0 + 0.002), (cx, FY1 - 0.08, 0.92), (xt, FY1 - 0.08, 0.92), (xt, 0.0, 0.92),
                       (xt, 0.0, zt - 0.005)], 0.08)
    mb.tube(rt.pts, 0.014, 10, "mat_steel", bw=0.0)
    return mb.to_object(scene, "vfd", matrix=Matrix.Translation((cx, (y0 + y1) / 2, (z0 + z1) / 2)), space="world",
                        bevel=0.004, segments=1)


def build_flows(scene, pipes):
    suc, s0, s1 = pipes["suc"]
    H.flow_path(scene, "suc", suc.flow_points(s0, s1, max_gap=0.18), spread=(0.03, 0.03))
    dis, d0, d1 = pipes["dis"]
    H.flow_path(scene, "dis", dis.flow_points(d0, d1, max_gap=0.18), spread=(0.03, 0.03))


def build_anchors(scene, p):
    xm0, xm1, mr = p["motor"]
    # spread out on screen: valve high, gauges over the suction gauge, pump past the motor's far end
    H.anchor(scene, "pump", (xm1 - 0.05, 0.0, ZS + mr + 0.28))
    H.anchor(scene, "meter", (CX, 0.75, Z_TOP + RB_D * 1.42 + 0.3))
    H.anchor(scene, "valve", (CX + 0.05, -0.3, 1.78))
    H.anchor(scene, "gauges", (-1.0, -0.05, ZS + 0.42))
    H.anchor(scene, "strainer", (-1.45, -0.1, 0.22))
    H.anchor(scene, "vfd", (0.87, FY1 - 0.25, 1.95))


def build(scene):
    H.ensure_materials()
    build_room(scene)
    p = pump.end_suction(scene, "pump", CX, ZS, PAD_H, RB_S, RB_D, R=R)
    pipes = build_piping(scene, p)
    build_vfd(scene, p)
    build_flows(scene, pipes)
    build_anchors(scene, p)
    return {"drives": DRIVES, "require": REQUIRE}
