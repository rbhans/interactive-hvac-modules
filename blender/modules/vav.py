"""VAV box teaching module: an office corner cut away like a dollhouse to show
the ceiling plenum above and the room below.

Layout (Blender Z-up, meters, front = -Y; air flows +X through the box):

  plenum (z 2.70 .. 3.75, no slab over it)
    supply main (x = -1.7, along Y, open section cut at y = -1.7, into the back wall)
      -> spin-in at y = 0 -> 10" round branch -> inlet collar [flow cross, butterfly
      damper; controller-actuator on the shaft, front] -> lined casing
      -> discharge duct (x 0.35 .. 2.2) -> flex drops -> diffusers
    a second takeoff + flex at y = 1.1 hints at the next zone's box
  room (z 0 .. 2.70; front (-Y) and right (+X) sides open)
    lay-in ceiling over y >= -0.3 (the strip in front is left open),
    square cone diffusers at (0.7, 0) and (1.9, 0), egg-crate return (-1.1, 1.2),
    thermostat on the back wall, desk + monitor + chair

The supply main is centered at z = 3.2 (not 3.275): the 10" branch at z = 3.2
must fit inside the main's side, which a 3.1 .. 3.45 main can't do.
"""
from mathutils import Matrix, Vector

import hvaclab as H
from parts import diffuser, piping, room, vav_box
from parts import ductwork as D

DRIVES = ["damperPos", "actuatorPos"]
SEG = 24

# ---- room -------------------------------------------------------------------
RX0, RX1 = -2.6, 2.6            # room interior (left wall face .. open right side)
RY0, RY1 = -1.7, 1.7            # open front .. back wall face
WALL_T, WALL_TOP, SLAB_T = 0.15, 3.75, 0.15
CEIL_Z, TILE_T = 2.70, 0.016    # tile top, tile thickness
FACE_Z = CEIL_Z - TILE_T - 0.003    # 2.681: bottom of the T-bar flanges (the ceiling plane)
CEIL_Y0 = -0.3
GRID_X = [round(RX0 + 0.6 * k, 6) for k in range(1, 9)]     # -2.0 .. 2.2
GRID_Y = [-0.3, 0.3, 0.9, 1.5]
DIFFUSERS = [(0.7, 0.0), (1.9, 0.0)]
GRILLE = (-1.1, 1.2)
TSTAT = (0.2, 1.5)              # x, z on the back wall

# ---- supply main ------------------------------------------------------------
MX, MW, MH, MZ, MT = -1.7, 0.55, 0.35, 3.2, 0.02
MX0, MX1 = MX - MW / 2, MX + MW / 2         # -1.975 / -1.425
MZ0, MZ1 = MZ - MH / 2, MZ + MH / 2         # 3.025 / 3.375
SPIN_R = 0.14                               # spin-in mouth bore (hole in the main's side)

# ---- branch, box, discharge --------------------------------------------------
AXZ = 3.2                       # round inlet / branch axis (y = 0)
R_OUT, R_IN = 0.125, 0.119      # 10" round: outer / bore
IN_X0 = -0.85                   # branch -> inlet collar joint
FLOW_X = -0.80                  # flow cross (clear of the open blade's edge at -0.767)
BLADE_X, BLADE_R, BLADE_T = -0.65, 0.117, 0.006
CAS_LO, CAS_HI, CAS_T = (-0.55, -0.3, 3.0), (0.35, 0.3, 3.4), 0.025
DIS_X0, DIS_X1 = 0.35, 2.2
DIS_Y0, DIS_Y1, DIS_Z0, DIS_Z1, DIS_T = -0.2, 0.2, 3.05, 3.35, 0.02
DROP_X = [d[0] for d in DIFFUSERS]
NECK_R_IN, NECK_R_OUT, NECK_TOP = 0.094, 0.1, 2.85
FLEX_TOP, FLEX_BOT = DIS_Z0 - 0.03, NECK_TOP - 0.05      # flex over the takeoff collar / diffuser neck
CTRL_LO, CTRL_HI = (-0.765, -0.235, 3.14), (-0.59, -0.165, 3.26)
PORT_Y = -0.20
PORT_ZS = (AXZ - 0.015, AXZ + 0.015)

REQUIRE = [
    "room", "room_floor", "room_wall_back", "room_wall_left", "ceiling_tiles", "ceiling_grid",
    "diffuser_01", "diffuser_02", "return_grille", "tstat", "desk", "monitor", "chair",
    "supply_main", "neighbor_takeoff", "static_tap", "branch_duct", "hangers",
    "vav_box", "vav_inlet", "vav_flow_cross", "vav_sense_tubes", "vav_damper_blade", "vav_controller",
    "vav_actuator_hub", "vav_casing", "vav_casing_front", "vav_hangers",
    "sa_discharge", "sa_discharge_front", "drop_01", "drop_02",
    "anchor_static", "anchor_flow", "anchor_damper", "anchor_box", "anchor_diffuser", "anchor_zone", "anchor_tstat",
    "flow_main_00", "flow_box_00", "flow_d1e_00", "flow_ret1_00",
]


# --------------------------------------------------------------------------
# Room
# --------------------------------------------------------------------------

def build_room(scene):
    rm = H.assembly(scene, "room", (0.0, 0.0, 1.35))
    room.floor(scene, "room_floor", RX0, RX1, RY0, RY1, t=SLAB_T, parent=rm)
    # walls run down to the slab's underside so the section reads as one cut
    zb, yb0, yb1, xl = -SLAB_T, RY1, RY1 + WALL_T, RX0 - WALL_T
    cut = D.CUT
    room.wall(scene, "room_wall_back", [
        ((xl, yb0, zb), (RX1, yb1, MZ0), {"+x": cut, "-z": cut}),
        ((xl, yb0, MZ0), (MX0, yb1, MZ1), {}),              # the supply main runs through here
        ((MX1, yb0, MZ0), (RX1, yb1, MZ1), {"+x": cut}),
        ((xl, yb0, MZ1), (RX1, yb1, WALL_TOP), {"+x": cut, "+z": cut}),
    ], parent=rm)
    room.wall(scene, "room_wall_left", [
        ((xl, RY0, zb), (RX0, RY1, WALL_TOP), {"-y": cut, "+z": cut, "-z": cut}),
    ], parent=rm)
    # ceiling: tiles stop at the wall angles' vertical legs (3 mm off the walls)
    holes = [(dx - 0.3, dx + 0.3, dy - 0.3, dy + 0.3) for dx, dy in DIFFUSERS]
    holes.append((GRILLE[0] - 0.3, GRILLE[0] + 0.3, GRILLE[1] - 0.3, GRILLE[1] + 0.3))
    room.ceiling_tiles(scene, "ceiling_tiles", RX0 + 0.003, RX1, GRID_Y + [RY1 - 0.003], CEIL_Z, TILE_T, holes,
                       cut_x=RX1, parent=rm)
    room.ceiling_grid(scene, "ceiling_grid", RX0, RX1, CEIL_Y0, RY1, GRID_X, GRID_Y, FACE_Z, parent=rm)
    room.return_grille(scene, "return_grille", GRILLE[0], GRILLE[1], FACE_Z, parent=rm)
    for k, (dx, dy) in enumerate(DIFFUSERS):
        diffuser.build(scene, "diffuser_%02d" % (k + 1), dx, dy, FACE_Z, neck_r_in=NECK_R_IN, neck_r_out=NECK_R_OUT,
                       neck_top=NECK_TOP, parent=rm, explode=(0.0, 0.0, -0.5))
    room.thermostat(scene, "tstat", TSTAT[0], RY1, TSTAT[1], parent=rm)
    room.desk(scene, "desk", 0.25, 1.55, 0.72, 1.40, parent=rm)
    room.monitor(scene, "monitor", 0.9, 1.22, 0.75, parent=rm)
    room.chair(scene, "chair", 0.9, 0.36, parent=rm)
    return rm


# --------------------------------------------------------------------------
# Plenum ductwork
# --------------------------------------------------------------------------

def build_main(scene):
    """Lined rectangular main along Y: open section cut at the front with a
    flange rim, one transverse joint each side of the takeoff, and a dark cap
    inside the back wall (it runs on beyond the diorama)."""
    y0, y1 = RY0, RY1 + WALL_T
    mb = H.MeshBuilder()
    D.panel(mb, (MX0, y0, MZ1 - MT), (MX1, y1, MZ1))
    D.panel(mb, (MX0, y0, MZ0), (MX1, y1, MZ0 + MT))
    D.panel(mb, (MX0, y0, MZ0 + MT), (MX0 + MT, y1, MZ1 - MT))
    D.panel(mb, (MX1 - MT, y0, MZ0 + MT), (MX1, y1, MZ1 - MT), hole=("circle", 0.0, AXZ, SPIN_R, SEG))
    inner = (MX, 0.0, MZ)
    mb.line_interior(0, inner)
    mb.line_interior(2, inner)
    mb.box((MX0 + MT, y1 - 0.02, MZ0 + MT), (MX1 - MT, y1, MZ1 - MT), "mat_liner", bw=0.0)
    D.flange(mb, 1, y0, y0 + 0.025, (MX0, 0, MZ0), (MX1, 0, MZ1), 0.022)
    for yj in (-0.85, 0.55):
        D.flange(mb, 1, yj - 0.0125, yj + 0.0125, (MX0, 0, MZ0), (MX1, 0, MZ1), 0.022)
    obj = mb.to_object(scene, "supply_main", matrix=Matrix.Translation((MX, (y0 + y1) / 2, MZ)), space="world",
                       bevel=0.003, segments=1)
    D.cut_faces(obj, (0, -1, 0), -y0)
    return obj


def build_branch(scene):
    """Conical spin-in on the main's +X side (flange against the main, mouth =
    the side's hole) and the 10" round branch to the inlet collar, one lathe."""
    x0 = MX1
    prof = [(x0, SPIN_R), (x0 + 0.08, R_IN), (IN_X0, R_IN), (IN_X0, R_OUT), (x0 + 0.085, R_OUT),
            (x0 + 0.006, SPIN_R + 0.007), (x0 + 0.006, 0.165), (x0, 0.165)]
    mb = H.MeshBuilder()
    D.lathe(mb, prof, SEG, "mat_duct", Matrix.Translation((0.0, 0.0, AXZ)), bw=0.6)
    # bead where the cone meets the straight run
    D.lathe(mb, [(x0 + 0.09, R_OUT), (x0 + 0.1, R_OUT), (x0 + 0.1, R_OUT + 0.003), (x0 + 0.09, R_OUT + 0.003)], SEG,
            "mat_duct", Matrix.Translation((0.0, 0.0, AXZ)), bw=0.3)
    return mb.to_object(scene, "branch_duct", matrix=Matrix.Translation(((x0 + IN_X0) / 2, 0.0, AXZ)), space="world",
                        bevel=0.0015, segments=1)


def build_neighbor(scene, y=1.1):
    """Another zone's takeoff: collar on the main's +X side and a flex that
    heads +X, then swings back and up into the back wall (static, solid)."""
    x0 = MX1
    mb = H.MeshBuilder()
    xf = Matrix.Translation((0.0, y, AXZ))
    # collar ends under the flex's plain cuff (its 12-gon stays outside the collar there)
    D.lathe(mb, [(x0, 0.0005), (x0 + 0.055, 0.0005), (x0 + 0.055, 0.1), (x0 + 0.006, 0.1), (x0 + 0.006, 0.126),
                 (x0, 0.126)], SEG, "mat_duct", xf, bw=0.6)
    rt = piping.Route([(x0 + 0.03, y, AXZ), (-1.0, y, AXZ), (-0.98, RY1 + 0.1, AXZ + 0.25)], 0.16)
    D.ribbed_tube(mb, rt, 0.107, 0.101, 0.03, 12, "mat_flex", end=0.03, r_end=0.105)
    D.lathe(mb, [(x0 + 0.035, 0.105), (x0 + 0.049, 0.105), (x0 + 0.049, 0.11), (x0 + 0.035, 0.11)], SEG,
            "mat_dark", xf, bw=0.4)
    return mb.to_object(scene, "neighbor_takeoff", matrix=Matrix.Translation((-1.15, (y + RY1) / 2, AXZ + 0.1)),
                        space="world", bevel=0.0015, segments=1)


def build_static_tap(scene, y=-0.5):
    """Duct static pressure: a probe boss on top of the main, a tube to a small
    transducer box sitting on the main."""
    xb, z = MX - 0.03, MZ1
    bx0, bx1 = MX + 0.04, MX + 0.14
    zp = z + 0.045
    mb = H.MeshBuilder()
    mb.cylinder((xb, y, z - 0.004), (xb, y, z + 0.012), 0.009, 12, "mat_steel", bw=0.5)
    rt = piping.Route([(xb, y, z + 0.008), (xb, y, zp), (bx0 - 0.004, y, zp)], 0.015)
    mb.tube(rt.pts, 0.003, 8, "mat_dark", bw=0.0)
    mb.box((bx0, y - 0.035, z), (bx1, y + 0.035, z + 0.065), "mat_frame", bw=1.0)
    mb.box((bx0 + 0.015, y - 0.0362, z + 0.022), (bx1 - 0.015, y - 0.0345, z + 0.045), "mat_accent", bw=0.1)
    mb.cylinder((bx0 + 0.001, y, zp), (bx0 - 0.004, y, zp), 0.0045, 6, "mat_valve", bw=0.4)
    mb.cylinder((bx0 - 0.003, y, zp), (bx0 - 0.012, y, zp), 0.002, 8, "mat_valve", bw=0.0)
    mb.cylinder((bx1 - 0.001, y, z + 0.03), (bx1 + 0.012, y, z + 0.03), 0.007, 10, "mat_dark", bw=0.3)
    return mb.to_object(scene, "static_tap", matrix=Matrix.Translation(((xb + bx1) / 2, y, z + 0.03)),
                        space="world", bevel=0.003, segments=1)


def build_vav(scene):
    vb = H.assembly(scene, "vav_box", ((IN_X0 + CAS_HI[0]) / 2, 0.0, AXZ), explode=(0.0, -0.9, 0.0))
    vav_box.inlet(scene, "vav_inlet", IN_X0, CAS_LO[0] + CAS_T + 0.01, AXZ, R_IN, R_OUT, BLADE_X, parent=vb)
    vav_box.flow_cross(scene, "vav_flow_cross", FLOW_X, AXZ, R_IN, parent=vb)
    vav_box.sense_tubes(scene, "vav_sense_tubes", FLOW_X, R_OUT, PORT_ZS, CTRL_LO[0], PORT_Y, parent=vb)
    blade = vav_box.damper_blade(scene, "vav_damper_blade", BLADE_X, AXZ, BLADE_R, BLADE_T, CTRL_LO[1] + 0.007,
                                 R_OUT + 0.013, "damperPos", (0.0, 90.0), parent=vb)
    ctrl = vav_box.controller(scene, "vav_controller", CTRL_LO, CTRL_HI, BLADE_X, AXZ, PORT_ZS, PORT_Y,
                              bracket_to_y=-(R_IN + R_OUT) / 2, parent=vb)
    hub = vav_box.hub(scene, "vav_actuator_hub", BLADE_X, CTRL_LO[1], AXZ, "actuatorPos", (0.0, 90.0), parent=ctrl)
    cas, front = vav_box.casing(scene, "vav_casing", CAS_LO, CAS_HI, CAS_T, AXZ, R_OUT,
                                (DIS_Y0 + DIS_T, DIS_Y1 - DIS_T, DIS_Z0 + DIS_T, DIS_Z1 - DIS_T), parent=vb,
                                front_explode=(0.0, -0.8, 0.0))
    return dict(assembly=vb, blade=blade, controller=ctrl, hub=hub, casing=cas, front=front)


def build_discharge(scene):
    """Lined rectangular discharge from the casing's outlet to an end cap, with
    a round takeoff collar through the bottom over each diffuser, a flange at
    the casing and a cutaway front panel."""
    x0, x1 = DIS_X0, DIS_X1
    inner = ((x0 + x1) / 2, 0.0, (DIS_Z0 + DIS_Z1) / 2)
    xm = (DROP_X[0] + DROP_X[1]) / 2
    mb = H.MeshBuilder()
    D.panel(mb, (x0, DIS_Y0, DIS_Z1 - DIS_T), (x1, DIS_Y1, DIS_Z1))
    for (a, b), dx in (((x0, xm), DROP_X[0]), ((xm, x1), DROP_X[1])):
        D.panel(mb, (a, DIS_Y0, DIS_Z0), (b, DIS_Y1, DIS_Z0 + DIS_T), hole=("circle", dx, 0.0, NECK_R_IN, SEG))
    D.panel(mb, (x0, DIS_Y1 - DIS_T, DIS_Z0 + DIS_T), (x1, DIS_Y1, DIS_Z1 - DIS_T))
    D.panel(mb, (x1 - DIS_T, DIS_Y0 + DIS_T, DIS_Z0 + DIS_T), (x1, DIS_Y1 - DIS_T, DIS_Z1 - DIS_T))
    for axis in range(3):
        mb.line_interior(axis, inner)
    D.flange(mb, 0, x0, x0 + 0.02, (0, DIS_Y0, DIS_Z0), (0, DIS_Y1, DIS_Z1), 0.02)
    for dx in DROP_X:
        D.tube_wall(mb, DIS_Z0 - 0.05, DIS_Z0, NECK_R_IN, NECK_R_OUT, SEG, "mat_duct", D.up_frame(dx, 0.0), bw=0.6)
    body = mb.to_object(scene, "sa_discharge", matrix=Matrix.Translation(inner), space="world", bevel=0.003,
                        segments=1)
    fb = H.MeshBuilder()
    D.panel(fb, (x0, DIS_Y0, DIS_Z0 + DIS_T), (x1, DIS_Y0 + DIS_T, DIS_Z1 - DIS_T))
    fb.line_interior(1, inner)
    front = fb.to_object(scene, "sa_discharge_front", matrix=Matrix.Translation(((x0 + x1) / 2, DIS_Y0 + DIS_T / 2,
                                                                                  inner[2])),
                         parent=body, space="world", bevel=0.003, segments=1)
    H.set_cutaway(front)
    return body, front


def build_drops(scene):
    """Short flex drops: bore = the takeoff collar's / neck's OD, ribbed jacket,
    a draw band at each end."""
    out = []
    for k, dx in enumerate(DROP_X):
        xf = D.up_frame(dx, 0.0)
        mb = H.MeshBuilder()
        D.lathe(mb, D.flex_profile(FLEX_BOT, FLEX_TOP, NECK_R_OUT, 0.112, 0.106, 0.026, end=0.022, r_end=0.105), SEG,
                "mat_flex", xf, bw=0.0)
        for za, zb in ((FLEX_TOP - 0.019, FLEX_TOP - 0.006), (FLEX_BOT + 0.006, FLEX_BOT + 0.019)):
            D.lathe(mb, [(za, 0.105), (zb, 0.105), (zb, 0.1095), (za, 0.1095)], SEG, "mat_dark", xf, bw=0.4)
        out.append(mb.to_object(scene, "drop_%02d" % (k + 1),
                                matrix=Matrix.Translation((dx, 0.0, (FLEX_TOP + FLEX_BOT) / 2)), space="world",
                                bevel=0.001, segments=1))
    return out


def build_hangers(scene, vb):
    """Threaded rods from the structure above (cut at the top of the diorama)
    on strut trapezes: two under the main, one under the discharge, and the
    box's own pair (they explode with it)."""
    mb = H.MeshBuilder()
    for y in (-1.05, 0.85):
        D.trapeze(mb, (MX0 - 0.045, y - 0.02, MZ0 - 0.025), (MX1 + 0.045, y + 0.02, MZ0),
                  [(MX0 - 0.022, y), (MX1 + 0.022, y)], WALL_TOP)
    xh = (DROP_X[0] + DROP_X[1]) / 2
    D.trapeze(mb, (xh - 0.02, DIS_Y0 - 0.05, DIS_Z0 - 0.025), (xh + 0.02, DIS_Y1 + 0.05, DIS_Z0),
              [(xh, DIS_Y0 - 0.025), (xh, DIS_Y1 + 0.025)], WALL_TOP)
    hangers = mb.to_object(scene, "hangers", matrix=Matrix.Translation((0.0, 0.0, 3.4)), space="world")
    vb_ = H.MeshBuilder()
    for x in (-0.40, 0.20):
        D.trapeze(vb_, (x - 0.02, CAS_LO[1] - 0.045, CAS_LO[2] - 0.025), (x + 0.02, CAS_HI[1] + 0.045, CAS_LO[2]),
                  [(x, CAS_LO[1] - 0.022), (x, CAS_HI[1] + 0.022)], WALL_TOP)
    vh = vb_.to_object(scene, "vav_hangers", matrix=Matrix.Translation((-0.1, 0.0, 3.4)), parent=vb, space="world")
    return hangers, vh


# --------------------------------------------------------------------------
# Flow fallback paths, anchors
# --------------------------------------------------------------------------

def build_flows(scene):
    # the main: air carrying on past this box to the other zones
    H.flow_path(scene, "main", [(MX, y, MZ) for y in (-1.7, -1.02, -0.34, 0.34, 1.02, 1.7)], spread=(0.22, 0.13))
    # this box: main -> spin-in -> branch -> inlet, flow cross, damper -> casing -> discharge -> drop_01 -> diffuser_01
    d1 = DROP_X[0]
    H.flow_path(scene, "box",
                [(MX, -0.60, MZ), (MX, -0.30, MZ), (-1.63, -0.07, AXZ), (-1.44, 0.0, AXZ), (-1.15, 0.0, AXZ),
                 (-0.90, 0.0, AXZ), (-0.72, 0.0, AXZ), (-0.52, 0.0, AXZ), (-0.30, 0.0, AXZ), (0.05, 0.0, AXZ),
                 (DIS_X0, 0.0, AXZ), (0.58, 0.0, 3.19), (d1 - 0.02, 0.0, 3.12), (d1, 0.0, 3.02), (d1, 0.0, 2.90),
                 (d1, 0.0, 2.78), (d1, 0.0, 2.705)],
                spread=[(0.1, 0.12), (0.1, 0.12), (0.1, 0.1), (0.1, 0.1), (0.1, 0.1), (0.1, 0.1), (0.1, 0.1),
                        (0.1, 0.1), (0.22, 0.14), (0.22, 0.14), (0.15, 0.1), (0.12, 0.08), (0.08, 0.06),
                        (0.08, 0.08), (0.08, 0.08), (0.08, 0.08), (0.12, 0.12)])
    # room: four throws per diffuser hugging the ceiling, then curling down. Where the two
    # diffusers' jets meet (x ~ 1.3) they drop together. Spreads per point: `across` is world Y,
    # `normal` is vertical on the east/west runs under the ceiling (kept small there) and
    # world X on the north/south runs and wherever a stream falls.
    zc0, zc1, zc2 = FACE_Z - 0.026, FACE_Z - 0.051, FACE_Z - 0.071       # 2.655 / 2.63 / 2.61
    ew = [(0.22, 0.02), (0.25, 0.03), (0.25, 0.05), (0.25, 0.09), (0.25, 0.11), (0.25, 0.12)]
    ns = [(0.08, 0.2), (0.1, 0.25), (0.1, 0.25), (0.1, 0.25), (0.12, 0.25), (0.12, 0.25)]
    for k, (dx, dy) in enumerate(DIFFUSERS):
        p = "d%d" % (k + 1)
        east = 1.25 if k == 0 else 2.48         # d1 meets d2's jet; d2 stops short of the open side
        west = -0.6 if k == 0 else 1.36
        if k == 0:
            H.flow_path(scene, p + "e", [(dx + 0.26, dy, zc0), (1.1, dy, zc1), (1.22, dy, 2.53), (east, dy, 2.1),
                                         (east, dy, 1.6)], spread=ew[:3] + [(0.25, 0.08), (0.25, 0.08)])
            H.flow_path(scene, p + "w", [(dx - 0.26, dy, zc0), (0.2, dy, zc1), (-0.15, dy, zc2), (-0.42, dy, 2.45),
                                         (-0.55, dy, 2.05), (west, dy, 1.55)], spread=ew)
        else:
            H.flow_path(scene, p + "e", [(dx + 0.26, dy, zc0), (2.33, dy, zc1), (2.45, dy, 2.5), (east, dy, 2.05),
                                         (east, dy, 1.6)], spread=ew[:3] + [(0.25, 0.07), (0.25, 0.07)])
            H.flow_path(scene, p + "w", [(dx - 0.26, dy, zc0), (1.5, dy, zc1), (1.39, dy, 2.53), (west, dy, 2.1),
                                         (west, dy, 1.6)], spread=ew[:3] + [(0.25, 0.08), (0.25, 0.08)])
        H.flow_path(scene, p + "n", [(dx, dy + 0.26, zc0), (dx, 0.55, zc1), (dx, 0.95, zc2), (dx, 1.3, 2.45),
                                     (dx, 1.45, 2.05), (dx, 1.45, 1.6)], spread=ns)
        H.flow_path(scene, p + "s", [(dx, dy - 0.26, zc0), (dx, -0.55, zc1), (dx, -0.95, zc2), (dx, -1.3, 2.45),
                                     (dx, -1.45, 2.05), (dx, -1.45, 1.55)], spread=ns)
    # returns: mid-room up into the egg-crate, ending just inside it
    gx, gy = GRILLE
    rs = [(0.25, 0.12), (0.25, 0.12), (0.25, 0.12), (0.2, 0.12), (0.16, 0.12), (0.15, 0.12)]
    H.flow_path(scene, "ret1", [(0.1, 0.35, 1.1), (-0.35, 0.6, 1.45), (-0.75, 0.9, 1.95), (-1.0, 1.1, 2.4),
                                (gx + 0.02, gy - 0.02, 2.62), (gx, gy, FACE_Z + 0.02)], spread=rs)
    H.flow_path(scene, "ret2", [(-1.7, -0.7, 1.2), (-1.6, -0.1, 1.55), (-1.35, 0.55, 2.0), (-1.17, 1.0, 2.4),
                                (gx - 0.01, gy - 0.03, 2.62), (gx, gy + 0.02, FACE_Z + 0.02)], spread=rs)


def build_anchors(scene):
    H.anchor(scene, "static", (MX + 0.09, -0.5, MZ1 + 0.19))
    H.anchor(scene, "flow", (FLOW_X - 0.04, 0.02, AXZ + R_OUT + 0.14))
    H.anchor(scene, "damper", (BLADE_X, (CTRL_LO[1] + CTRL_HI[1]) / 2, CTRL_HI[2] + 0.07))
    H.anchor(scene, "box", (0.0, 0.0, CAS_HI[2] + 0.12))
    H.anchor(scene, "diffuser", (DIFFUSERS[0][0], DIFFUSERS[0][1], 2.45))
    H.anchor(scene, "zone", (0.2, 0.3, 1.6))
    H.anchor(scene, "tstat", (TSTAT[0], RY1 - 0.1, TSTAT[1] + 0.12))


def build(scene):
    H.ensure_materials()
    build_room(scene)
    build_main(scene)
    build_branch(scene)
    build_neighbor(scene)
    build_static_tap(scene)
    vav = build_vav(scene)
    build_discharge(scene)
    build_drops(scene)
    build_hangers(scene, vav["assembly"])
    build_flows(scene)
    build_anchors(scene)
    return {"drives": DRIVES, "require": REQUIRE}
