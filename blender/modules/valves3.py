"""Three-way vs. two-way valves teaching module: a chilled-water loop along a
mechanical-room wall, cut like a section model (the left end is the cut where
the pipes go off to the chiller).

Layout (Blender Z-up, meters, front = -Y):

  left cut (x = -3.6): chilled water comes in low, the warm return goes out high
  pump: end-suction on a pad at x = -2.7, discharge straight up, then forward
    into the supply main
  supply main (4"): y = -0.78, z = 2.55, along +X to an end cap at 3.4
  return main (4"): y = -1.1, z = 2.25, from 3.4 back to the cut
  three coil stations at x = -0.6, 1.1, 2.8: a slice of an air handler with a
    chilled-water coil, its headers facing the front. Per station:
      supply drop (2.5") at x + 0.2 off the supply main, down and in to the coil
      return (2.5") out the top of the coil at x - 0.2, forward through the
        three-way valve, up into the return main
      bypass (2.5") from the supply drop across to the valve's bottom port, with
        its balancing valve (shut = the valve works as a two-way)
  DP transmitter across the far station
"""
from mathutils import Matrix, Vector

import hvaclab as H
from parts import ductwork as D
from parts import housing, hydronic, piping, pump, room

DRIVES = ["pumpSpeed", "valvePos1", "valvePos2", "valvePos3"]
SEG = 24

FX0, FX1 = -3.6, 3.7
FY0, FY1 = -1.6, 0.6
WALL_T, WALL_TOP, SLAB_T = 0.15, 3.1, 0.15

# pump and plant side
PCX, PZS, PR = -2.7, 0.52, 0.23
PAD_X0, PAD_X1, PAD_Y, PAD_H = -3.3, -1.25, 0.42, 0.1
RB_M, RI_M = 0.057, 0.09            # 4" mains
RB_B, RI_B = 0.0365, 0.065          # 2.5" branches
FLANGE_T = 0.022

# mains
YS, ZSM = -0.78, 2.55               # supply
YR, ZRM = -1.10, 2.25               # return
X_END = 3.4

# stations
STATIONS = [-0.6, 1.1, 2.8]
DX = 0.2                            # supply at x + DX, return at x - DX
Z_SUP, Z_RET, Z_BYP = 0.72, 1.38, 1.0
Y_CONN = -0.47                      # coil connection flange faces
AHU_Y0, AHU_Y1, AHU_Z0, AHU_Z1 = -0.42, 0.42, 0.45, 1.65

REQUIRE = [
    "floor_slab", "wall_back", "pad", "pump", "pump_casing", "pump_casing_front", "pump_impeller",
    "sup_main", "ret_main", "suction", "dp_sensor",
    "coil1_fins", "coil2_fins", "coil3_fins", "ahu1_front", "ahu3_front",
    "s1_pipe", "r1_pipe", "b1_pipe", "s3_pipe", "r3_pipe", "b3_pipe",
    "tv1_valve", "tv1_valve_stem", "tv2_valve_stem", "tv3_valve_stem", "bv1", "bv3",
    "anchor_pump", "anchor_dp", "anchor_return", "anchor_supply", "anchor_ahu1", "anchor_ahu2", "anchor_ahu3",
    "flow_sup_00", "flow_ret_00", "flow_suc_00", "flow_s1_00", "flow_d1_00", "flow_c1_00", "flow_r1_00", "flow_b1_00",
    "tv1_valve_port", "tv3_valve_port",
    "flow_b3_00",
]


def build_room(scene):
    cut = D.CUT
    mb = H.MeshBuilder()
    D.box6(mb, (FX0, FY0, -SLAB_T), (FX1, FY1, 0.0), {"-y": cut, "+x": cut, "-x": cut, "-z": cut}, "mat_concrete",
           bw=0.4)
    mb.to_object(scene, "floor_slab", matrix=Matrix.Translation(((FX0 + FX1) / 2, (FY0 + FY1) / 2, -SLAB_T / 2)),
                 space="world", bevel=0.003, segments=1)
    pb = H.MeshBuilder()
    pb.box((PAD_X0, -PAD_Y, 0.0), (PAD_X1, PAD_Y, PAD_H), "mat_concrete", bw=1.0)
    pb.to_object(scene, "pad", matrix=Matrix.Translation(((PAD_X0 + PAD_X1) / 2, 0.0, PAD_H / 2)), space="world",
                 bevel=0.012, segments=2)
    room.wall(scene, "wall_back", [
        ((FX0, FY1, -SLAB_T), (FX1, FY1 + WALL_T, WALL_TOP), {"+x": cut, "-x": cut, "+z": cut, "-z": cut}),
    ])


def build_station(scene, k, cx):
    """One coil station: an air-handler slice with its coil, the coil's piping,
    three-way valve and bypass. Returns its routes."""
    n = k + 1
    xs, xr = cx + DX, cx - DX
    # ── air-handler slice: top, bottom and back panels, the front as the cutaway, on a stand ──
    hs = H.assembly(scene, "ahu%d" % n, (cx, 0.0, (AHU_Z0 + AHU_Z1) / 2))
    x0, x1 = cx - 0.42, cx + 0.42
    inside = (cx, 0.0, (AHU_Z0 + AHU_Z1) / 2)
    t = 0.03
    housing.panel(scene, "ahu%d_back" % n, (x0, AHU_Y1 - t, AHU_Z0 + t), (x1, AHU_Y1, AHU_Z1 - t), parent=hs, inner=inside)
    housing.panel(scene, "ahu%d_top" % n, (x0, AHU_Y0, AHU_Z1 - t), (x1, AHU_Y1, AHU_Z1), parent=hs, inner=inside)
    housing.panel(scene, "ahu%d_bottom" % n, (x0, AHU_Y0, AHU_Z0), (x1, AHU_Y1, AHU_Z0 + t), parent=hs, inner=inside)
    front = housing.panel(scene, "ahu%d_front" % n, (x0, AHU_Y0, AHU_Z0 + t), (x1, AHU_Y0 + t, AHU_Z1 - t),
                          parent=hs, inner=inside)
    H.set_cutaway(front)
    for o in (scene.objects["ahu%d_back" % n], scene.objects["ahu%d_top" % n], scene.objects["ahu%d_bottom" % n], front):
        D.cut_faces(o, (-1, 0, 0), -x0)
        D.cut_faces(o, (1, 0, 0), x1)
    sb = H.MeshBuilder()
    for lx in (x0 + 0.05, x1 - 0.09):
        for ly in (AHU_Y0 + 0.05, AHU_Y1 - 0.09):
            sb.box((lx, ly, 0.0), (lx + 0.04, ly + 0.04, AHU_Z0), "mat_frame", bw=0.6)
    sb.box((x0 + 0.03, AHU_Y0 + 0.03, AHU_Z0 - 0.05), (x1 - 0.03, AHU_Y1 - 0.03, AHU_Z0 - 0.001), "mat_frame", bw=0.6)
    sb.to_object(scene, "ahu%d_stand" % n, matrix=Matrix.Translation((cx, 0.0, AHU_Z0 / 2)), parent=hs, space="world",
                 bevel=0.003, segments=1)

    # ── the coil: fin pack, channel frame, headers on the front end, connection stubs ──
    fz0, fz1 = AHU_Z0 + t + 0.06, AHU_Z1 - t - 0.06
    fy = 0.32
    fb = H.MeshBuilder()
    fb.box((cx - 0.15, -fy, fz0), (cx + 0.15, fy, fz1), "mat_fin", bw=0.0)
    fb.to_object(scene, "coil%d_fins" % n, matrix=Matrix.Translation((cx, 0.0, (fz0 + fz1) / 2)), parent=hs,
                 space="world")
    cb = H.MeshBuilder()
    for za, zb in ((fz0 - 0.04, fz0), (fz1, fz1 + 0.04)):
        cb.box((cx - 0.16, -fy - 0.012, za), (cx + 0.16, fy + 0.012, zb), "mat_steel", bw=0.6)
    for ya, yb in ((-fy - 0.012, -fy), (fy, fy + 0.012)):
        cb.box((cx - 0.16, ya, fz0), (cx + 0.16, yb, fz1), "mat_steel", bw=0.6)
    yh = -fy - 0.045
    for hx, conn_z in ((xs, Z_SUP), (xr, Z_RET)):
        cb.cylinder((hx, yh, fz0 + 0.02), (hx, yh, fz1 - 0.02), 0.03, 16, "mat_copper", bw=0.6)
        for kk in range(7):
            zf = fz0 + 0.07 + kk * (fz1 - fz0 - 0.14) / 6
            fx = hx + (0.06 if hx < cx else -0.06)
            # feeders end just inside the fin pack, not on the tube sheet's face
            cb.tube([Vector((hx, yh, zf)), Vector((fx, yh, zf)), Vector((fx, -fy + 0.004, zf))], 0.007, 8, "mat_copper",
                    bw=0.0)
        cb.cylinder((hx, yh, conn_z), (hx, Y_CONN + 0.013, conn_z), RB_B, 16, "mat_copper", bw=0.4)
        cb.cylinder((hx, Y_CONN + 0.013, conn_z), (hx, Y_CONN, conn_z), RB_B * 1.75 + 0.02, 20, "mat_steel", bw=0.8)
    cb.to_object(scene, "coil%d_headers" % n, matrix=Matrix.Translation((cx, yh, (fz0 + fz1) / 2)), parent=hs,
                 space="world", bevel=0.0015, segments=1)

    # ── piping ──
    yc = Y_CONN - FLANGE_T
    sup = piping.Route([(xs, YS, ZSM), (xs, YS, Z_SUP), (xs, yc, Z_SUP)], 0.1)
    ret = piping.Route([(xr, yc, Z_RET), (xr, YR, Z_RET), (xr, YR, ZRM)], 0.1)
    tv = hydronic.three_way_valve(scene, "tv%d" % n, ret, (xr, YS, Z_RET), RB_B, "valvePos%d" % n)
    port = tv["port"]
    byp = piping.Route([(xr, YS, port.z), (xr, YS, Z_BYP), (xs, YS, Z_BYP)], 0.08)
    bv, g_bv = piping.balancing_valve(scene, "bv%d" % n, byp, (cx, YS, Z_BYP), RB_B)
    mb = H.MeshBuilder()
    for c, a in (((xs, yc, Z_SUP), (0, 1, 0)), ((xr, yc, Z_RET), (0, 1, 0))):
        mb.cylinder(Vector(c), Vector(c) + Vector(a) * FLANGE_T, RB_B * 1.75 + 0.02, 20, "mat_steel", bw=0.8)
    mb.to_object(scene, "st%d_flanges" % n, matrix=Matrix.Translation((cx, yc, (Z_SUP + Z_RET) / 2)), space="world",
                 bevel=0.0015, segments=1)
    piping.jacket(scene, "s%d_pipe" % n, sup, RI_B, s0=0.0, s1=sup.length, seg=20)
    piping.jacket(scene, "r%d_pipe" % n, ret, RI_B, gaps=[tv["gap"]], s0=0.0, s1=ret.length, seg=20)
    piping.jacket(scene, "b%d_pipe" % n, byp, RI_B, gaps=[g_bv], s0=0.015, s1=byp.length, seg=20)
    return dict(sup=sup, ret=ret, byp=byp, valve_s=ret.s_of((xr, YS, Z_RET)), tee_s=sup.s_of((xs, YS, Z_BYP)), xs=xs,
                xr=xr)


def build_plant(scene):
    p = pump.end_suction(scene, "pump", PCX, PZS, PAD_H, RB_M, RB_M, R=PR)
    # suction from the cut
    xs = p["suction_x"] - FLANGE_T
    suc = piping.Route([(FX0, 0.0, PZS), (xs, 0.0, PZS)], 0.2)
    fl, g1 = hydronic.flex_connector(scene, "suction_flex", suc, (xs - (2.4 * RB_M + 0.05) / 2, 0.0, PZS), RB_M)
    bv, g2 = hydronic.butterfly_valve(scene, "suction_valve", suc, (xs - 0.42, 0.0, PZS), RB_M)
    piping.jacket(scene, "suction", suc, RI_M, gaps=[g2], s0=0.0, s1=g1[0], seg=24)
    # discharge up, forward, and along as the supply main
    zd = p["discharge_z"] + FLANGE_T
    sup = piping.Route([(PCX, 0.0, zd), (PCX, 0.0, ZSM), (PCX, YS, ZSM), (X_END, YS, ZSM)], 0.2)
    fd, h1 = hydronic.flex_connector(scene, "discharge_flex", sup, (PCX, 0.0, zd + (2.4 * RB_M + 0.05) / 2), RB_M)
    fm, h2 = hydronic.mag_meter(scene, "flow_meter", sup, (-1.9, YS, ZSM), RB_M, display=(0.0, -1.0, 0.0))
    piping.jacket(scene, "sup_main", sup, RI_M, gaps=[h2], s0=h1[1], s1=sup.length - 0.02, seg=24)
    # return main back to the cut
    ret = piping.Route([(X_END, YR, ZRM), (FX0, YR, ZRM)], 0.2)
    piping.jacket(scene, "ret_main", ret, RI_M, s0=0.02, s1=ret.length, seg=24)
    # end caps, pump flanges, hangers
    mb = H.MeshBuilder()
    for y, z, ri in ((YS, ZSM, RI_M), (YR, ZRM, RI_M)):
        mb.cylinder((X_END - 0.02, y, z), (X_END + 0.015, y, z), ri + 0.006, 24, "mat_steel", bw=0.8)
    mb.cylinder((p["suction_x"], 0, PZS), (p["suction_x"] - FLANGE_T, 0, PZS), RB_M * 1.75 + 0.02, 24, "mat_steel", bw=0.8)
    mb.cylinder((PCX, 0, p["discharge_z"]), (PCX, 0, zd), RB_M * 1.75 + 0.02, 24, "mat_steel", bw=0.8)
    for x in (-3.2, -1.4, 0.25, 1.95, 3.35):
        for y, z, ri in ((YS, ZSM, RI_M), (YR, ZRM, RI_M)):
            if y == YR or x > PCX + 0.3:
                mb.cylinder((x, y, z + ri + 0.004), (x, y, WALL_TOP), 0.006, 8, "mat_steel", bw=0.0)
                xf = H.basis((1, 0, 0), (0, 1, 0), (0, 0, 1), (0.0, y, z))
                D.lathe(mb, [(x - 0.02, ri + 0.001), (x + 0.02, ri + 0.001), (x + 0.02, ri + 0.008), (x - 0.02, ri + 0.008)],
                        SEG, "mat_steel", xf, bw=0.4)
    mb.to_object(scene, "mains_hardware", matrix=Matrix.Translation((0.0, YS, ZSM)), space="world", bevel=0.002,
                 segments=1)
    return dict(pump=p, suc=suc, sup=sup, ret=ret, sup_s0=h1[1])


def build(scene):
    H.ensure_materials()
    build_room(scene)
    plant = build_plant(scene)
    stations = [build_station(scene, k, cx) for k, cx in enumerate(STATIONS)]

    # DP transmitter across the far station's supply drop and return
    st = stations[2]
    hydronic.dp_transmitter(scene, "dp_sensor", (STATIONS[2] + 0.0, YR + 0.05, 0.55),
                            [(st["xs"], YS - RB_B, 0.95), (st["xr"], YR + 0.12, Z_RET - RB_B)])

    # flows: the plant side, then each station: supply, coil return up to the valve, mixed return after it, bypass
    H.flow_path(scene, "suc", plant["suc"].flow_points(0.0, plant["suc"].length, 0.2), spread=(0.03, 0.03))
    sup = plant["sup"]
    H.flow_path(scene, "sup", sup.flow_points(plant["sup_s0"] - 0.1, sup.length - 0.03, 0.2), spread=(0.03, 0.03))
    H.flow_path(scene, "ret", plant["ret"].flow_points(0.0, plant["ret"].length, 0.2), spread=(0.03, 0.03))
    for k, s in enumerate(stations):
        n = k + 1
        # the supply drop carries the whole branch down to the bypass tee, then only the coil's share
        H.flow_path(scene, "s%d" % n, s["sup"].flow_points(0.0, s["tee_s"], 0.15), spread=(0.02, 0.02))
        H.flow_path(scene, "d%d" % n, s["sup"].flow_points(s["tee_s"], s["sup"].length, 0.15), spread=(0.02, 0.02))
        H.flow_path(scene, "c%d" % n, s["ret"].flow_points(0.0, s["valve_s"], 0.15), spread=(0.02, 0.02))
        H.flow_path(scene, "r%d" % n, s["ret"].flow_points(s["valve_s"], s["ret"].length, 0.15), spread=(0.02, 0.02))
        H.flow_path(scene, "b%d" % n, list(reversed(s["byp"].flow_points(0.0, s["byp"].length, 0.12))),
                    spread=(0.02, 0.02))
        H.anchor(scene, "ahu%d" % n, (STATIONS[k] - 0.3, AHU_Y0, AHU_Z1 + 0.18))

    xm0, xm1, mr = plant["pump"]["motor"]
    H.anchor(scene, "pump", (xm1 - 0.05, 0.0, PZS + mr + 0.28))
    H.anchor(scene, "dp", (STATIONS[2] + 0.1, YR, 0.75))
    H.anchor(scene, "supply", (FX0 + 0.25, 0.0, PZS + 0.3))
    H.anchor(scene, "return", (FX0 + 0.3, YR, ZRM + 0.25))
    return {"drives": DRIVES, "require": REQUIRE}
