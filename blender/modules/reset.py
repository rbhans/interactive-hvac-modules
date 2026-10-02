"""Static pressure reset teaching module: one floor of an office cut like an
architect's section model. The interior walls stop at desk height so the four
zones read from above; the ceiling is gone except a small patch around each
diffuser, so the whole duct system shows over the rooms.

Layout (Blender Z-up, meters, front = -Y):

  mechanical room (x < -4.3): the air handler's fan section on the floor, a
    riser up to the plenum and the fan's drive (VFD) on the back wall
  supply main (y = 0, z = 3.2, along +X from the riser to an end cap at 3.9)
    takeoffs, in order down the main:
      VAV-1 open office   x = -2.7, front (-Y)
      VAV-2 offices       x = -1.3, back  (+Y)
      static pressure sensor on top, x = 0.2
      VAV-3 conference    x =  1.4, front
      VAV-4 corner office x =  2.9, back
  zones: open office front-left, offices back-left, conference front-right,
    corner office back-right; floor carpets tinted by room temperature

Each box is built once in its own frame (the VAV module's: air flows +X from
the main's side wall, the controller in front at -Y), then the box's assembly
empty turns it to face out of the main's front or back.
"""
import math

from mathutils import Matrix, Vector

import hvaclab as H
from parts import diffuser, fan, housing, piping, room, vav_box
from parts import ductwork as D

DRIVES = ["fanSpeed", "damper1", "damper2", "damper3", "damper4", "actuator1", "actuator2", "actuator3", "actuator4"]
SEG = 24

# ---- floor plan -------------------------------------------------------------
FX0, FX1 = -6.2, 4.6            # slab (mechanical room at the left end)
FY0, FY1 = -2.6, 2.6            # open front .. back wall face
MECH_X = -4.3                   # mechanical room partition (center line)
PX, PY = 0.1, 0.0               # zone partitions (center lines)
PART_T, PART_H = 0.1, 1.1       # interior partitions, cut at desk-and-a-bit height
WALL_T, WALL_TOP, SLAB_T, CARPET = 0.15, 3.75, 0.15, 0.012
FACE_Z = 2.681                  # ceiling plane (bottom of the T-bar flanges)
TILE_T = 0.016

# ---- air handler fan section (same section as the coils module's unit) ------
AX0, AX1 = -6.1, -4.5
AY0, AY1 = -0.6, 0.6
AZ0, AZ1 = 0.15, 1.35
T, INSET, EDGE = 0.03, 0.003, 0.035
IY0, IY1 = AY0 + INSET + T, AY1 - INSET - T
IZ0, IZ1 = AZ0 + INSET + T, AZ1 - INSET - T
FAN_C = Vector((-5.2, 0.0, 0.75))
FAN_WALL = -5.47
COIL_X0, COIL_X1 = -5.92, -5.74

# ---- riser and supply main --------------------------------------------------
MW, MH, MZ, MT = 0.55, 0.35, 3.2, 0.02
MY0, MY1 = -MW / 2, MW / 2
MZ0, MZ1 = MZ - MH / 2, MZ + MH / 2         # 3.025 / 3.375
RX0, RX1 = -5.05, -4.70                     # riser (its +X face opens into the main)
MAIN_X0, MAIN_X1 = RX1, 3.9
SENSOR_X = 0.2
JOINTS = [-3.6, -2.0, -0.5, 0.8, 2.15, 3.45]
SPLIT_FRONT, SPLIT_BACK = -0.5, 0.8        # where the side panels meet (under joints)

# ---- the boxes, in their own frame (x from the main's centerline) -----------
HW = MW / 2                     # the main's side wall (outer face)
AXZ = 3.2
R_OUT, R_IN = 0.125, 0.119
SPIN_R = 0.14
IN_X0 = 0.60
FLOW_X = 0.65
BLADE_X, BLADE_R, BLADE_T = 0.80, 0.117, 0.006
CAS_LO, CAS_HI, CAS_T = (0.90, -0.3, 3.0), (1.50, 0.3, 3.4), 0.025
DIS_X0, DIS_X1 = 1.50, 2.00
DIS_Y0, DIS_Y1, DIS_Z0, DIS_Z1, DIS_T = -0.2, 0.2, 3.05, 3.35, 0.02
DROP_X = 1.75
NECK_R_IN, NECK_R_OUT, NECK_TOP = 0.094, 0.1, 2.85
FLEX_TOP, FLEX_BOT = DIS_Z0 - 0.03, NECK_TOP - 0.05
CTRL_LO, CTRL_HI = (0.685, -0.235, 3.14), (0.86, -0.165, 3.26)
PORT_Y = -0.20
PORT_ZS = (AXZ - 0.015, AXZ + 0.015)

# (tap x on the main, side: -1 front / +1 back)
BOXES = [(-2.7, -1), (-1.3, 1), (1.4, -1), (2.9, 1)]
ZONES = [  # carpet extents (x0, x1, y0, y1)
    (MECH_X, PX, FY0, PY),
    (MECH_X, PX, PY, FY1),
    (PX, FX1, FY0, PY),
    (PX, FX1, PY, FY1),
]

REQUIRE = [
    "floor_slab", "mech_floor", "zone1_floor", "zone2_floor", "zone3_floor", "zone4_floor",
    "wall_back", "wall_left", "partitions",
    "ahu", "ahu_front", "ahu_back", "ahu_roof", "ahu_end", "fan_wheel", "fan_motor", "vfd",
    "riser", "riser_front", "supply_main", "supply_main_front", "static_tap", "main_hangers",
    "vav1", "vav1_damper_blade", "vav1_controller", "vav1_actuator_hub", "vav1_casing", "vav1_casing_front",
    "vav4", "vav4_damper_blade", "vav4_actuator_hub", "vav4_casing_front", "vav4_drop", "vav4_diffuser",
    "anchor_fan", "anchor_static", "anchor_vav1", "anchor_vav2", "anchor_vav3", "anchor_vav4",
    "flow_ahu_00", "flow_main_00", "flow_b1_00", "flow_b4_00", "flow_t1e_00", "flow_t4w_00",
]


def box_frame(k):
    """Box k's frame: its own +X out of the main's front (-Y) or back (+Y)."""
    x, side = BOXES[k]
    return Matrix.Translation((x, 0.0, 0.0)) @ Matrix.Rotation(math.radians(90.0 * side), 4, "Z")


def to_world(k, p):
    return (box_frame(k) @ Vector(p)).to_tuple()


# --------------------------------------------------------------------------
# Building: slab, walls, partitions, zone floors, furniture
# --------------------------------------------------------------------------

def build_building(scene):
    cut = D.CUT
    mb = H.MeshBuilder()
    D.box6(mb, (FX0, FY0, -SLAB_T), (FX1, FY1, -CARPET), {k: cut for k in D.FACE_KEYS}, cut)
    mb.to_object(scene, "floor_slab", matrix=Matrix.Translation(((FX0 + FX1) / 2, 0.0, -SLAB_T / 2)), space="world",
                 bevel=0.003, segments=1)
    mm = H.MeshBuilder()
    D.box6(mm, (FX0, FY0, -CARPET), (MECH_X, FY1, 0.0), {"-y": cut}, "mat_concrete", bw=0.4)
    mm.to_object(scene, "mech_floor", matrix=Matrix.Translation(((FX0 + MECH_X) / 2, 0.0, -CARPET / 2)),
                 space="world", bevel=0.002, segments=1)
    for k, (x0, x1, y0, y1) in enumerate(ZONES):
        zb = H.MeshBuilder()
        mats = {}
        if y0 == FY0:
            mats["-y"] = cut
        if x1 == FX1:
            mats["+x"] = cut
        D.box6(zb, (x0, y0, -CARPET), (x1, y1, 0.0), mats, "mat_carpet", bw=0.4)
        zb.to_object(scene, "zone%d_floor" % (k + 1), matrix=Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2,
                                                                                  -CARPET / 2)),
                     space="world", bevel=0.002, segments=1)
    # outside walls, full height, cut at the top, the slab's underside and the open sides
    room.wall(scene, "wall_back", [
        ((FX0 - WALL_T, FY1, -SLAB_T), (FX1, FY1 + WALL_T, WALL_TOP), {"+x": cut, "+z": cut, "-z": cut}),
    ])
    # the left wall is cut low like the partitions, so the mechanical room shows from the front
    room.wall(scene, "wall_left", [
        ((FX0 - WALL_T, FY0, -SLAB_T), (FX0, FY1, PART_H), {"-y": cut, "+z": cut, "-z": cut}),
    ])
    # interior partitions: cut flat at PART_H, ends cut where they meet the open sides; they stand on
    # the carpet and stop a millimetre short of the outside walls, so no faces share a plane
    h = PART_T / 2
    z0 = 0.0
    top = {"+z": cut}
    room.wall(scene, "partitions", [
        ((MECH_X - h, FY0, z0), (MECH_X + h, FY1 - 0.001, PART_H), dict(top, **{"-y": cut})),
        ((MECH_X + h, PY - h, z0), (FX1, PY + h, PART_H), dict(top, **{"+x": cut})),
        ((PX - h, FY0, z0), (PX + h, PY - h, PART_H), dict(top, **{"-y": cut})),
        ((PX - h, PY + h, z0), (PX + h, FY1 - 0.001, PART_H), top),
    ])


def build_furniture(scene):
    # open office: two desks against the partition, chairs facing them (+Y)
    for k, (x0, x1) in enumerate(((-3.95, -2.85), (-2.35, -1.25))):
        cx = (x0 + x1) / 2
        room.desk(scene, "desk_%02d" % (k + 1), x0, x1, -0.76, -0.08)
        room.monitor(scene, "monitor_%02d" % (k + 1), cx, -0.26, 0.75)
        room.chair(scene, "chair_%02d" % (k + 1), cx, -1.12)
    # offices: a desk against the back wall
    room.desk(scene, "desk_03", -3.4, -2.3, 1.92, 2.59)
    room.monitor(scene, "monitor_03", -2.85, 2.41, 0.75)
    room.chair(scene, "chair_03", -2.85, 1.56)
    # conference room: a long table, chairs along its front
    room.desk(scene, "conference_table", 1.0, 3.6, -1.55, -0.6, top_z=0.74)
    for k, cx in enumerate((1.45, 2.3, 3.15)):
        room.chair(scene, "chair_%02d" % (k + 4), cx, -1.91)
    # corner office
    room.desk(scene, "desk_04", 3.3, 4.4, 1.92, 2.59)
    room.monitor(scene, "monitor_04", 3.85, 2.41, 0.75)
    room.chair(scene, "chair_07", 3.85, 1.56)


# --------------------------------------------------------------------------
# Air handler fan section, its drive, the riser
# --------------------------------------------------------------------------

def build_ahu(scene):
    hs = H.assembly(scene, "ahu", ((AX0 + AX1) / 2, 0.0, (AZ0 + AZ1) / 2))
    xa, xb = AX0 + EDGE, AX1 - EDGE
    inside = ((AX0 + AX1) / 2, 0.0, (AZ0 + AZ1) / 2)
    housing.panel(scene, "ahu_back", (xa, AY1 - INSET - T, AZ0 + EDGE), (xb, AY1 - INSET, AZ1 - EDGE), parent=hs,
                  inner=inside)
    front = housing.panel(scene, "ahu_front", (xa, AY0 + INSET, AZ0 + EDGE), (xb, AY0 + INSET + T, AZ1 - EDGE),
                          parent=hs, inner=inside)
    H.set_cutaway(front)
    H.set_explode(front, (0.0, -1.2, 0.0))
    # the roof opens into the riser
    housing.panel(scene, "ahu_roof", (xa, AY0 + EDGE, IZ1), (xb, AY1 - EDGE, AZ1 - INSET),
                  hole=("rect", RX0 + MT, RX1 - MT, MY0 + MT, MY1 - MT), parent=hs, inner=inside)
    housing.panel(scene, "ahu_floor", (xa, AY0 + EDGE, AZ0 + INSET), (xb, AY1 - EDGE, IZ0), parent=hs, inner=inside)
    # return air comes in through the open end from the room (the mechanical room is the return plenum)
    housing.panel(scene, "ahu_end", (AX1 - INSET - T, AY0 + EDGE, AZ0 + EDGE), (AX1 - INSET, AY1 - EDGE, AZ1 - EDGE),
                  parent=hs, inner=inside)
    housing.panel(scene, "ahu_inlet", (AX0 + INSET, AY0 + EDGE, AZ0 + EDGE), (AX0 + INSET + T, AY1 - EDGE, AZ1 - EDGE),
                  hole=("rect", -0.42, 0.42, 0.33, 1.17), parent=hs, inner=inside)
    housing.edge_frame(scene, "ahu_edges", (AX0, AY0, AZ0), (AX1, AY1, AZ1), EDGE, open_min_x=False,
                       x_start=AX0 + EDGE, parent=hs)
    housing.base_rail(scene, "ahu_rail_01", AX0, AX1, -0.42, outward=-1, height=AZ0 + INSET, parent=hs)
    housing.base_rail(scene, "ahu_rail_02", AX0, AX1, 0.42, outward=1, height=AZ0 + INSET, parent=hs)
    # a cooling coil just inside the inlet: a fin pack in a channel frame
    cb = H.MeshBuilder()
    y0, y1, z0, z1 = IY0 + 0.001, IY1 - 0.001, IZ0 + 0.001, IZ1 - 0.001
    cb.box((COIL_X0, y0 + 0.04, z0 + 0.04), (COIL_X1, y1 - 0.04, z1 - 0.04), "mat_fin", bw=0.0)
    for ya, yb in ((y0, y0 + 0.04), (y1 - 0.04, y1)):
        cb.box((COIL_X0 - 0.005, ya, z0), (COIL_X1 + 0.005, yb, z1), "mat_frame", bw=0.6)
    for za, zb in ((z0, z0 + 0.04), (z1 - 0.04, z1)):
        cb.box((COIL_X0 - 0.005, y0 + 0.04, za), (COIL_X1 + 0.005, y1 - 0.04, zb), "mat_frame", bw=0.6)
    cb.to_object(scene, "ahu_coil", matrix=Matrix.Translation(((COIL_X0 + COIL_X1) / 2, 0.0, 0.75)), parent=hs,
                 space="world", bevel=0.002, segments=1)
    # the supply fan: plug fan on a bulkhead, like the coils module's
    fa = H.assembly(scene, "fan_assembly", FAN_C, parent=hs, explode=(0.0, -0.9, 0.0))
    fan.wheel(scene, "fan_wheel", FAN_C, diameter=0.6, width=0.2, blades=10, parent=fa)
    fan.inlet(scene, "fan_inlet", FAN_C, wall_x=FAN_WALL, overlap_x=FAN_C.x - 0.1 + 0.032, parent=fa)
    fan.wall(scene, "fan_wall", FAN_WALL, IY0 + 0.001, IY1 - 0.001, IZ0 + 0.001, IZ1 - 0.001, (0.0, FAN_C.z), 0.262,
             parent=fa)
    mx0, mx1 = FAN_C.x + 0.135, AX1 - INSET - T - 0.037
    fan.motor(scene, "fan_motor", 0.0, FAN_C.z, x0=mx0, x1=mx1, shaft_from=FAN_C.x + 0.08, parent=fa)
    fan.base(scene, "fan_base", FAN_WALL + 0.06, mx1 - 0.01, IZ0 + 0.001, 0.64, mx0 + 0.015, mx1 - 0.07, parent=fa)
    return hs


def build_vfd(scene):
    """The fan's variable frequency drive on the back wall, with its keypad
    display, and conduit down the wall and along the floor to the unit."""
    x0, x1, y0, y1, z0, z1 = -5.75, -5.25, FY1 - 0.2, FY1 - 0.001, 1.05, 1.85
    mb = H.MeshBuilder()
    mb.box((x0, y0, z0), (x1, y1, z1), "mat_housing", bw=1.0)
    fy = y0 - 0.0012
    mb.box((x0 + 0.03, fy, z1 - 0.2), (x1 - 0.03, y0 + 0.001, z1 - 0.04), "mat_frame", bw=0.2)       # keypad panel
    mb.box((x0 + 0.08, fy - 0.001, z1 - 0.15), (x1 - 0.08, y0 + 0.0005, z1 - 0.08), "mat_dark", bw=0.1)   # display
    mb.box((x0 + 0.1, fy - 0.0018, z1 - 0.135), (x0 + 0.24, fy - 0.0008, z1 - 0.105), "mat_accent", bw=0.1)
    for k in range(4):
        mb.box((x0 + 0.04, fy, z0 + 0.12 + 0.05 * k), (x1 - 0.04, y0 + 0.001, z0 + 0.135 + 0.05 * k), "mat_frame",
               bw=0.0)                                                                                     # vents
    # conduit: out the bottom, down the wall, along the floor to the fan section's back
    rt = piping.Route([((x0 + x1) / 2, FY1 - 0.06, z0 + 0.002), ((x0 + x1) / 2, FY1 - 0.06, 0.05),
                       ((x0 + x1) / 2, AY1 + 0.02, 0.05), ((x0 + x1) / 2, AY1 + 0.02, 0.42)], 0.08)
    mb.tube(rt.pts, 0.013, 10, "mat_steel", bw=0.0)
    return mb.to_object(scene, "vfd", matrix=Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)),
                        space="world", bevel=0.004, segments=1)


def build_riser(scene):
    """Rectangular riser off the unit's roof up to the plenum, its +X side
    opening into the supply main; the front (-Y) side is its own cutaway
    panel."""
    zb, zt = AZ1 - INSET, MZ1
    inner = ((RX0 + RX1) / 2, 0.0, (zb + zt) / 2)
    mb = H.MeshBuilder()
    D.panel(mb, (RX0, MY0, zt - MT), (RX1, MY1, zt))
    D.panel(mb, (RX0, MY1 - MT, zb), (RX1, MY1, zt - MT))
    D.panel(mb, (RX0, MY0 + MT, zb), (RX0 + MT, MY1 - MT, zt - MT))
    # the +X side stops at the main's floor: above it the riser is open into the main
    D.panel(mb, (RX1 - MT, MY0 + MT, zb), (RX1, MY1 - MT, MZ0 + MT))
    for axis in range(3):
        mb.line_interior(axis, inner)
    D.flange(mb, 2, zb, zb + 0.025, (RX0, MY0, 0), (RX1, MY1, 0), 0.022)
    D.flange(mb, 2, 2.35, 2.375, (RX0, MY0, 0), (RX1, MY1, 0), 0.022)
    body = mb.to_object(scene, "riser", matrix=Matrix.Translation(inner), space="world", bevel=0.003, segments=1)
    fb = H.MeshBuilder()
    D.panel(fb, (RX0, MY0, zb), (RX1, MY0 + MT, zt - MT))
    fb.line_interior(1, inner)
    front = fb.to_object(scene, "riser_front", matrix=Matrix.Translation(((RX0 + RX1) / 2, MY0 + MT / 2, inner[2])),
                         parent=body, space="world", bevel=0.003, segments=1)
    H.set_cutaway(front)
    return body


# --------------------------------------------------------------------------
# Supply main, static pressure sensor, hangers
# --------------------------------------------------------------------------

def build_main(scene):
    """Lined rectangular main along +X: the round spin-in holes for the back
    boxes in the back side, for the front boxes in the front side (its own
    cutaway panel), transverse joints, an end cap."""
    x0, x1 = MAIN_X0, MAIN_X1
    inner = ((x0 + x1) / 2, 0.0, MZ)
    mb = H.MeshBuilder()
    D.panel(mb, (x0, MY0, MZ1 - MT), (x1, MY1, MZ1))
    D.panel(mb, (x0, MY0, MZ0), (x1, MY1, MZ0 + MT))
    # the back side, in pieces between the back boxes' holes (a panel takes one hole)
    # each side panel takes one box's hole; they meet under a transverse joint's flange
    back = [bx for bx, side in BOXES if side > 0]
    edges = [x0, SPLIT_BACK, x1 - MT]
    for (a, b), bx in zip(zip(edges, edges[1:]), back):
        D.panel(mb, (a, MY1 - MT, MZ0 + MT), (b, MY1, MZ1 - MT), hole=("circle", AXZ, bx, SPIN_R, SEG))
    D.panel(mb, (x1 - MT, MY0 + MT, MZ0 + MT), (x1, MY1 - MT, MZ1 - MT))
    for axis in range(3):
        mb.line_interior(axis, inner)
    D.flange(mb, 0, x0, x0 + 0.025, (0, MY0, MZ0), (0, MY1, MZ1), 0.022)
    for xj in JOINTS:
        D.flange(mb, 0, xj - 0.0125, xj + 0.0125, (0, MY0, MZ0), (0, MY1, MZ1), 0.022)
    body = mb.to_object(scene, "supply_main", matrix=Matrix.Translation(inner), space="world", bevel=0.003,
                        segments=1)
    fb = H.MeshBuilder()
    front = [bx for bx, side in BOXES if side < 0]
    edges = [x0, SPLIT_FRONT, x1 - MT]
    for (a, b), bx in zip(zip(edges, edges[1:]), front):
        D.panel(fb, (a, MY0, MZ0 + MT), (b, MY0 + MT, MZ1 - MT), hole=("circle", AXZ, bx, SPIN_R, SEG))
    fb.line_interior(1, inner)
    fr = fb.to_object(scene, "supply_main_front", matrix=Matrix.Translation(((x0 + x1) / 2, MY0 + MT / 2, MZ)),
                      parent=body, space="world", bevel=0.003, segments=1)
    H.set_cutaway(fr)
    return body


def build_static_tap(scene):
    """Duct static pressure: a probe boss on top of the main, a tube to a small
    transducer box sitting on the main."""
    x, z = SENSOR_X, MZ1
    yb = -0.13
    by0, by1 = -0.03, 0.07
    zp = z + 0.045
    mb = H.MeshBuilder()
    mb.cylinder((x, yb, z - 0.004), (x, yb, z + 0.012), 0.009, 12, "mat_steel", bw=0.5)
    rt = piping.Route([(x, yb, z + 0.008), (x, yb, zp), (x, by0 - 0.004, zp)], 0.015)
    mb.tube(rt.pts, 0.003, 8, "mat_dark", bw=0.0)
    mb.box((x - 0.035, by0, z), (x + 0.035, by1, z + 0.065), "mat_frame", bw=1.0)
    mb.box((x - 0.0362, by0 + 0.015, z + 0.022), (x - 0.0345, by1 - 0.015, z + 0.045), "mat_accent", bw=0.1)
    mb.cylinder((x, by0 + 0.001, zp), (x, by0 - 0.004, zp), 0.0045, 6, "mat_valve", bw=0.4)
    mb.cylinder((x, by0 - 0.003, zp), (x, by0 - 0.012, zp), 0.002, 8, "mat_valve", bw=0.0)
    mb.cylinder((x, by1 - 0.001, z + 0.03), (x, by1 + 0.012, z + 0.03), 0.007, 10, "mat_dark", bw=0.3)
    return mb.to_object(scene, "static_tap", matrix=Matrix.Translation((x, (yb + by1) / 2, z + 0.03)),
                        space="world", bevel=0.003, segments=1)


def build_main_hangers(scene):
    mb = H.MeshBuilder()
    for x in (-4.2, -3.4, -2.05, -0.6, 0.7, 2.1, 3.6):
        D.trapeze(mb, (x - 0.02, MY0 - 0.045, MZ0 - 0.025), (x + 0.02, MY1 + 0.045, MZ0),
                  [(x, MY0 - 0.022), (x, MY1 + 0.022)], WALL_TOP)
    return mb.to_object(scene, "main_hangers", matrix=Matrix.Translation((0.0, 0.0, 3.4)), space="world")


# --------------------------------------------------------------------------
# A VAV box with its branch, discharge, drop, diffuser and ceiling patch
# --------------------------------------------------------------------------

def build_box(scene, k):
    n = k + 1
    p = "vav%d" % n
    vb = H.assembly(scene, p, (0.0, 0.0, 0.0))
    # branch: conical spin-in on the main's side (its mouth = the side's hole) and the 10" round run
    x0 = HW
    prof = [(x0, SPIN_R), (x0 + 0.08, R_IN), (IN_X0, R_IN), (IN_X0, R_OUT), (x0 + 0.085, R_OUT),
            (x0 + 0.006, SPIN_R + 0.007), (x0 + 0.006, 0.165), (x0, 0.165)]
    mb = H.MeshBuilder()
    D.lathe(mb, prof, SEG, "mat_duct", Matrix.Translation((0.0, 0.0, AXZ)), bw=0.6)
    D.lathe(mb, [(x0 + 0.09, R_OUT), (x0 + 0.1, R_OUT), (x0 + 0.1, R_OUT + 0.003), (x0 + 0.09, R_OUT + 0.003)], SEG,
            "mat_duct", Matrix.Translation((0.0, 0.0, AXZ)), bw=0.3)
    mb.to_object(scene, p + "_branch", matrix=Matrix.Translation(((x0 + IN_X0) / 2, 0.0, AXZ)), parent=vb,
                 space="world", bevel=0.0015, segments=1)
    # the box: inlet collar, flow cross, damper, controller-actuator, casing
    vav_box.inlet(scene, p + "_inlet", IN_X0, CAS_LO[0] + CAS_T + 0.01, AXZ, R_IN, R_OUT, BLADE_X, parent=vb)
    vav_box.flow_cross(scene, p + "_flow_cross", FLOW_X, AXZ, R_IN, parent=vb)
    vav_box.sense_tubes(scene, p + "_sense_tubes", FLOW_X, R_OUT, PORT_ZS, CTRL_LO[0], PORT_Y, parent=vb)
    vav_box.damper_blade(scene, p + "_damper_blade", BLADE_X, AXZ, BLADE_R, BLADE_T, CTRL_LO[1] + 0.007,
                         R_OUT + 0.013, "damper%d" % n, (0.0, 90.0), parent=vb)
    ctrl = vav_box.controller(scene, p + "_controller", CTRL_LO, CTRL_HI, BLADE_X, AXZ, PORT_ZS, PORT_Y,
                              bracket_to_y=-(R_IN + R_OUT) / 2, parent=vb)
    vav_box.hub(scene, p + "_actuator_hub", BLADE_X, CTRL_LO[1], AXZ, "actuator%d" % n, (0.0, 90.0), parent=ctrl)
    vav_box.casing(scene, p + "_casing", CAS_LO, CAS_HI, CAS_T, AXZ, R_OUT,
                   (DIS_Y0 + DIS_T, DIS_Y1 - DIS_T, DIS_Z0 + DIS_T, DIS_Z1 - DIS_T), parent=vb,
                   front_explode=(0.0, -0.7, 0.0))
    # discharge: lined rectangular run to an end cap, one round takeoff collar down to the flex
    inner = ((DIS_X0 + DIS_X1) / 2, 0.0, (DIS_Z0 + DIS_Z1) / 2)
    db = H.MeshBuilder()
    D.panel(db, (DIS_X0, DIS_Y0, DIS_Z1 - DIS_T), (DIS_X1, DIS_Y1, DIS_Z1))
    D.panel(db, (DIS_X0, DIS_Y0, DIS_Z0), (DIS_X1, DIS_Y1, DIS_Z0 + DIS_T), hole=("circle", DROP_X, 0.0, NECK_R_IN, SEG))
    D.panel(db, (DIS_X0, DIS_Y1 - DIS_T, DIS_Z0 + DIS_T), (DIS_X1, DIS_Y1, DIS_Z1 - DIS_T))
    D.panel(db, (DIS_X1 - DIS_T, DIS_Y0 + DIS_T, DIS_Z0 + DIS_T), (DIS_X1, DIS_Y1 - DIS_T, DIS_Z1 - DIS_T))
    for axis in range(3):
        db.line_interior(axis, inner)
    D.flange(db, 0, DIS_X0, DIS_X0 + 0.02, (0, DIS_Y0, DIS_Z0), (0, DIS_Y1, DIS_Z1), 0.02)
    D.tube_wall(db, DIS_Z0 - 0.05, DIS_Z0, NECK_R_IN, NECK_R_OUT, SEG, "mat_duct", D.up_frame(DROP_X, 0.0), bw=0.6)
    dis = db.to_object(scene, p + "_discharge", matrix=Matrix.Translation(inner), parent=vb, space="world",
                       bevel=0.003, segments=1)
    fb = H.MeshBuilder()
    D.panel(fb, (DIS_X0, DIS_Y0, DIS_Z0 + DIS_T), (DIS_X1, DIS_Y0 + DIS_T, DIS_Z1 - DIS_T))
    fb.line_interior(1, inner)
    front = fb.to_object(scene, p + "_discharge_front",
                         matrix=Matrix.Translation(((DIS_X0 + DIS_X1) / 2, DIS_Y0 + DIS_T / 2, inner[2])),
                         parent=dis, space="world", bevel=0.003, segments=1)
    H.set_cutaway(front)
    # flex drop with a draw band at each end
    xf = D.up_frame(DROP_X, 0.0)
    fl = H.MeshBuilder()
    D.lathe(fl, D.flex_profile(FLEX_BOT, FLEX_TOP, NECK_R_OUT, 0.112, 0.106, 0.026, end=0.022, r_end=0.105), SEG,
            "mat_flex", xf, bw=0.0)
    for za, zb in ((FLEX_TOP - 0.019, FLEX_TOP - 0.006), (FLEX_BOT + 0.006, FLEX_BOT + 0.019)):
        D.lathe(fl, [(za, 0.105), (zb, 0.105), (zb, 0.1095), (za, 0.1095)], SEG, "mat_dark", xf, bw=0.4)
    fl.to_object(scene, p + "_drop", matrix=Matrix.Translation((DROP_X, 0.0, (FLEX_TOP + FLEX_BOT) / 2)), parent=vb,
                 space="world", bevel=0.001, segments=1)
    diffuser.build(scene, p + "_diffuser", DROP_X, 0.0, FACE_Z, neck_r_in=NECK_R_IN, neck_r_out=NECK_R_OUT,
                   neck_top=NECK_TOP, parent=vb)
    build_ceiling_patch(scene, p + "_ceiling", DROP_X, 0.0, parent=vb)
    # hangers: the box's own pair and one under the discharge
    hb = H.MeshBuilder()
    for x in (CAS_LO[0] + 0.15, CAS_HI[0] - 0.15):
        D.trapeze(hb, (x - 0.02, CAS_LO[1] - 0.045, CAS_LO[2] - 0.025), (x + 0.02, CAS_HI[1] + 0.045, CAS_LO[2]),
                  [(x, CAS_LO[1] - 0.022), (x, CAS_HI[1] + 0.022)], WALL_TOP)
    xh = DIS_X1 - 0.07
    D.trapeze(hb, (xh - 0.02, DIS_Y0 - 0.05, DIS_Z0 - 0.025), (xh + 0.02, DIS_Y1 + 0.05, DIS_Z0),
              [(xh, DIS_Y0 - 0.025), (xh, DIS_Y1 + 0.025)], WALL_TOP)
    hb.to_object(scene, p + "_hangers", matrix=Matrix.Translation((1.2, 0.0, 3.4)), parent=vb, space="world")
    # turn the whole box out of the main's side
    vb.matrix_basis = box_frame(k)
    return vb


def build_ceiling_patch(scene, name, cx, cy, parent=None, border=0.3, cell=0.6):
    """A scrap of lay-in ceiling around a diffuser: its grid cell left open for
    it and a border of cut tiles, with the T-bars: main tees along Y
    continuous, cross tees between them."""
    h = cell / 2
    xs = [cx - h - border, cx - h, cx + h, cx + h + border]
    ys = [cy - h - border, cy - h, cy + h, cy + h + border]
    cells = 3
    ztop = FACE_Z + 0.003 + TILE_T
    mb = H.MeshBuilder()
    for i in range(cells):
        for j in range(cells):
            if i == 1 and j == 1:
                continue
            mats = {}
            if i == 0:
                mats["-x"] = D.CUT
            if i == cells - 1:
                mats["+x"] = D.CUT
            if j == 0:
                mats["-y"] = D.CUT
            if j == cells - 1:
                mats["+y"] = D.CUT
            # tiles stop 1 mm short of each other: no shared faces
            D.box6(mb, (xs[i] + 0.0005, ys[j] + 0.0005, ztop - TILE_T), (xs[i + 1] - 0.0005, ys[j + 1] - 0.0005, ztop),
                   mats, "mat_ceiling", bw=0.0)
    f2, ft = 0.012, 0.003
    for x in xs[1:-1]:
        mb.box((x - f2, ys[0] + 0.002, FACE_Z), (x + f2, ys[-1] - 0.002, FACE_Z + ft), "mat_tbar", bw=0.0)
    for y in ys[1:-1]:
        for a, b in zip(xs, xs[1:]):
            lo = a + (f2 if a > xs[0] else 0.002)
            hi = b - (f2 if b < xs[-1] else 0.002)
            mb.box((lo, y - f2, FACE_Z), (hi, y + f2, FACE_Z + ft), "mat_tbar", bw=0.0)
    return mb.to_object(scene, name, matrix=Matrix.Translation((cx, cy, FACE_Z)), parent=parent, space="world")


# --------------------------------------------------------------------------
# Air paths (the 3D view's streams), anchors
# --------------------------------------------------------------------------

def build_flows(scene):
    # through the unit: the open return end, the coil, into the fan's inlet, out and up the riser
    rx = (RX0 + RX1) / 2
    H.flow_path(scene, "ahu", [(-6.4, 0.0, 0.75), (-5.85, 0.0, 0.75), (-5.5, 0.0, 0.75), (-5.12, 0.0, 0.75),
                               (-4.95, 0.0, 1.05), (rx, 0.0, 1.55), (rx, 0.0, 2.3), (rx, 0.0, 3.05),
                               (rx + 0.25, 0.0, MZ)],
                spread=[(0.6, 0.5), (0.55, 0.5), (0.2, 0.2), (0.25, 0.25), (0.3, 0.25), (0.22, 0.13), (0.22, 0.13),
                        (0.2, 0.12), (0.22, 0.13)])
    H.flow_path(scene, "main", [(x, 0.0, MZ) for x in (-4.5, -3.1, -1.7, -0.3, 1.1, 2.5, 3.8)], spread=(0.22, 0.13))
    for k, (bx, side) in enumerate(BOXES):
        n = k + 1
        local = [(0.10, 0.0, MZ), (0.27, 0.0, AXZ), (0.45, 0.0, AXZ), (0.63, 0.0, AXZ), (0.76, 0.0, AXZ),
                 (0.95, 0.0, AXZ), (1.2, 0.0, AXZ), (1.45, 0.0, AXZ), (1.6, 0.0, 3.19), (DROP_X - 0.02, 0.0, 3.12),
                 (DROP_X, 0.0, 3.02), (DROP_X, 0.0, 2.90), (DROP_X, 0.0, 2.78), (DROP_X, 0.0, 2.705)]
        pts = [(bx - 0.5, 0.0, MZ), (bx - 0.25, 0.0, MZ)] + [to_world(k, q) for q in local]
        H.flow_path(scene, "b%d" % n, pts,
                    spread=[(0.12, 0.12), (0.1, 0.12), (0.1, 0.1), (0.1, 0.1), (0.1, 0.1), (0.1, 0.1), (0.1, 0.1),
                            (0.1, 0.1), (0.22, 0.14), (0.22, 0.14), (0.15, 0.1), (0.12, 0.08), (0.08, 0.06),
                            (0.08, 0.08), (0.08, 0.08), (0.08, 0.08)])
        # four throws under the ceiling, curling down into the room; the zone's walls bound them
        dx, dy, _ = to_world(k, (DROP_X, 0.0, 0.0))
        x0, x1, y0, y1 = ZONES[k]
        zc0, zc1, zc2 = FACE_Z - 0.026, FACE_Z - 0.051, FACE_Z - 0.071
        ew = [(0.22, 0.02), (0.25, 0.03), (0.25, 0.05), (0.25, 0.09), (0.25, 0.11)]
        for tag, sx, sy in (("e", 1, 0), ("w", -1, 0), ("n", 0, 1), ("s", 0, -1)):
            room_x = (x1 - 0.25 - dx) if sx > 0 else (dx - x0 - 0.25) if sx < 0 else 0.0
            room_y = (y1 - 0.25 - dy) if sy > 0 else (dy - y0 - 0.15) if sy < 0 else 0.0
            reach = min(1.35, room_x if sx else room_y)
            pt = lambda d, z: (dx + sx * d, dy + sy * d, z)
            H.flow_path(scene, "t%d%s" % (n, tag),
                        [pt(0.26, zc0), pt(0.26 + 0.45 * (reach - 0.26), zc1), pt(0.26 + 0.8 * (reach - 0.26), zc2),
                         pt(reach, 2.35), pt(reach, 1.75)],
                        spread=ew if sx else [(0.08, 0.2), (0.1, 0.25), (0.1, 0.25), (0.12, 0.25), (0.12, 0.25)])


def build_anchors(scene):
    H.anchor(scene, "fan", (-5.3, 0.0, AZ1 + 0.25))
    H.anchor(scene, "static", (SENSOR_X + 0.02, 0.0, MZ1 + 0.2))
    for k in range(4):
        n = k + 1
        H.anchor(scene, "vav%d" % n, to_world(k, ((CAS_LO[0] + CAS_HI[0]) / 2, 0.0, CAS_HI[2] + 0.12)))
        x0, x1, y0, y1 = ZONES[k]
        H.anchor(scene, "zone%d" % n, ((x0 + x1) / 2, (y0 + y1) / 2, 1.3))


def build(scene):
    H.ensure_materials()
    build_building(scene)
    build_furniture(scene)
    build_ahu(scene)
    build_vfd(scene)
    build_riser(scene)
    build_main(scene)
    build_static_tap(scene)
    build_main_hangers(scene)
    for k in range(4):
        build_box(scene, k)
    build_flows(scene)
    build_anchors(scene)
    return {"drives": DRIVES, "require": REQUIRE}
