"""Coils & valves teaching module: an air handler's coil section on the rooftop
diorama. Hot-water preheat coil + chilled-water cooling coil (drain pan, P-trap),
each with its piping train (2-way globe control valve + linear actuator on the
return, isolation ball valves, balancing valve, dial thermometers), a
discharge-air averaging sensor and the plug fan into the supply duct.

Layout (Blender Z-up, meters, front = -Y, air flows left -> right):

   section cut | filter | HW coil | CHW coil (+ pan) | DAT | fan bulkhead + plug fan | -> supply duct -> wall
      x=-2.2     -1.6     -0.95       -0.30            0.12        0.45 / 0.72          1.3        2.6

The left end is an architectural section cut: the unit continues upstream (the
mixing section) and its cut faces are poured in mat_cut. Piping trains stand in
front of the unit (y < -0.62): the HW train opens to the left, the CHW train to
the right, so the two never cross.
"""
import math

from mathutils import Matrix, Vector

import hvaclab as H
from parts import coil, fan, housing, piping, site

DRIVES = ["chwValvePos", "hwValvePos", "fanSpeed"]

# unit envelope (same section and construction as the economizer)
X0, X1 = -2.2, 1.3
Y0, Y1 = -0.6, 0.6
Z0, Z1 = 0.15, 1.35
T = 0.03            # panel thickness
INSET = 0.003       # panels sit 3 mm inside the edge framing
EDGE = 0.035        # edge framing bar size

IY0, IY1 = Y0 + INSET + T, Y1 - INSET - T      # -0.567 / 0.567
IZ0, IZ1 = Z0 + INSET + T, Z1 - INSET - T      # 0.183 / 1.317
SEAL = (IY0 + 0.001, IY1 - 0.001, IZ0 + 0.001, IZ1 - 0.001)

FILTER_X = -1.6
HW_X, HW_D = -0.95, 0.12
CHW_X, CHW_D = -0.30, 0.25
PAN_X0, PAN_X1 = -0.62, 0.0
PAN_Z0 = IZ0 + 0.002            # pan bottom
PAN_FLOOR = PAN_Z0 + 0.004      # top of the pan floor
PAN_RIM = PAN_Z0 + 0.052
WATER_Z = PAN_FLOOR + 0.008
DAT_X, DAT_HEAD_Z = 0.12, 0.75
FAN_WALL = 0.45
FAN_C = Vector((0.72, 0.0, 0.75))
WALL_X = 2.6

FACE_W = 0.99                   # finned width; tube sheets at +/-0.50, headers/bends beyond
CHANNEL = 0.04
CONN_Y = -0.655                 # coil connection flange joint, just outside the front panel
YP = -0.77                      # piping plane in front of the unit

HW = dict(rb=0.017, ri=0.034, bend=0.065, header_r=0.020, conn_z=(0.30, 1.20))
CHW = dict(rb=0.021, ri=0.040, bend=0.075, header_r=0.024, conn_z=(0.44, 1.20))

REQUIRE = [
    "housing_back", "housing_floor", "housing_roof", "housing_front", "housing_end", "housing_edges",
    "base_rail_01", "base_rail_02",
    "filter_bank", "filter_frame", "filter_media",
    "hw_coil", "hw_coil_fins", "hw_coil_casing", "hw_coil_headers", "hw_coil_bends",
    "chw_coil", "chw_coil_fins", "chw_coil_casing", "chw_coil_headers", "chw_coil_bends",
    "chw_drain_pan", "chw_trap", "dat_sensor", "dat_sensor_head",
    "fan_assembly", "fan_wheel", "fan_inlet", "fan_wall", "fan_motor", "fan_base",
    "sa_duct",
    "hw_piping", "hw_supply_pipe", "hw_return_pipe", "hw_valve", "hw_valve_actuator", "hw_valve_stem",
    "hw_valve_indicator", "hw_ball_valve_01", "hw_ball_valve_02", "hw_balancing_valve",
    "hw_thermometer_01", "hw_thermometer_02", "hw_supply_curb", "hw_return_curb", "hw_fittings",
    "chw_piping", "chw_supply_pipe", "chw_return_pipe", "chw_valve", "chw_valve_actuator", "chw_valve_stem",
    "chw_valve_indicator", "chw_ball_valve_01", "chw_ball_valve_02", "chw_balancing_valve",
    "chw_thermometer_01", "chw_thermometer_02", "chw_supply_curb", "chw_return_curb", "chw_fittings",
    "anchor_eat", "anchor_hw", "anchor_chw", "anchor_dat", "anchor_hw_valve", "anchor_chw_valve",
    "anchor_sa", "anchor_pan",
    "flow_chws_00", "flow_chwr_00", "flow_hws_00", "flow_hwr_00", "flow_air_00",
    "drip_a", "drip_b", "drip_pan",
    "site", "site_deck", "site_wall", "site_pavers",
]


# --------------------------------------------------------------------------
# Housing with a section cut at X0
# --------------------------------------------------------------------------

def cap_cut(obj, x=X0, mat="mat_cut", eps=1e-4):
    """Pour the section: faces lying in the cut plane x = `x` (facing -X) get
    `mat`, and their edges lose the bevel weight so the cut stays crisp."""
    me = obj.data
    mw = H.world_matrix(obj)
    rot = mw.to_3x3()
    names = [m.name for m in me.materials]
    if mat not in names:
        me.materials.append(H.material(mat))
        names.append(mat)
    mi = names.index(mat)
    bw = me.attributes.get("bevel_weight_edge")
    ekey = {tuple(sorted(e.vertices)): e.index for e in me.edges}
    n = 0
    for p in me.polygons:
        if (rot @ p.normal).normalized().x < -0.999 and abs((mw @ p.center).x - x) < eps:
            p.material_index = mi
            n += 1
            if bw is not None:
                for ek in p.edge_keys:
                    bw.data[ekey[tuple(sorted(ek))]].value = 0.0
    me.update()
    return n


def build_housing(scene):
    hs = H.assembly(scene, "housing", ((X0 + X1) / 2, 0.0, (Z0 + Z1) / 2))
    xa, xb = X0, X1 - EDGE
    inside = ((X0 + X1) / 2, 0.0, (Z0 + Z1) / 2)
    parts = [
        housing.panel(scene, "housing_back", (xa, Y1 - INSET - T, Z0 + EDGE), (xb, Y1 - INSET, Z1 - EDGE),
                      parent=hs, inner=inside),
    ]
    front = housing.panel(scene, "housing_front", (xa, Y0 + INSET, Z0 + EDGE), (xb, Y0 + INSET + T, Z1 - EDGE),
                          parent=hs, inner=inside)
    H.set_cutaway(front)
    H.set_explode(front, (0.0, -1.3, 0.0))
    parts.append(front)
    parts.append(housing.panel(scene, "housing_roof", (xa, Y0 + EDGE, IZ1), (xb, Y1 - EDGE, Z1 - INSET),
                               parent=hs, inner=inside))
    parts.append(housing.panel(scene, "housing_floor", (xa, Y0 + EDGE, Z0 + INSET), (xb, Y1 - EDGE, IZ0),
                               parent=hs, inner=inside))
    housing.panel(scene, "housing_end", (X1 - INSET - T, Y0 + EDGE, Z0 + EDGE), (X1 - INSET, Y1 - EDGE, Z1 - EDGE),
                  hole=("rect", -0.4, 0.4, 0.35, 1.15), parent=hs, inner=inside)
    parts.append(housing.edge_frame(scene, "housing_edges", (X0, Y0, Z0), (X1, Y1, Z1), EDGE, x_start=X0, parent=hs))
    parts.append(housing.base_rail(scene, "base_rail_01", X0, X1, -0.42, outward=-1, height=Z0 + INSET, parent=hs))
    parts.append(housing.base_rail(scene, "base_rail_02", X0, X1, 0.42, outward=1, height=Z0 + INSET, parent=hs))
    for o in parts:
        cap_cut(o)
    return hs


# --------------------------------------------------------------------------
# Filter (same construction as the economizer's), DAT sensor
# --------------------------------------------------------------------------

def build_filter(scene, x=FILTER_X, depth=0.10, member=0.035):
    fb = H.assembly(scene, "filter_bank", (x, 0.0, 0.75), explode=(0.0, -0.6, 0.0))
    y0, y1, z0, z1 = IY0 + 0.001, IY1 - 0.001, IZ0 + 0.001, IZ1 - 0.001
    xa, xb = x - depth / 2, x + depth / 2
    mb = H.MeshBuilder()
    mb.box((xa, y0, z1 - member), (xb, y1, z1), "mat_frame")
    mb.box((xa, y0, z0), (xb, y1, z0 + member), "mat_frame")
    for ya, yb in ((y0, y0 + member), (y1 - member, y1)):
        mb.box((xa, ya, z0 + member), (xb, yb, z1 - member), "mat_frame")
    mb.to_object(scene, "filter_frame", matrix=Matrix.Translation((x, 0.0, 0.75)), parent=fb, space="world",
                 bevel=0.003, segments=1)
    mm = H.MeshBuilder()
    mz0, mz1 = z0 + member - 0.002, z1 - member + 0.002
    xf0, xf1 = xa + 0.012, xb - 0.012
    by0, by1 = y0 + member, y1 - member
    n = int(round((by1 - by0) / 0.034))
    step = (by1 - by0 - 0.004) / (2 * n)
    pts = [(xf0 if k % 2 == 0 else xf1, by0 + 0.002 + k * step) for k in range(2 * n + 1)]
    for k, ((xa_, ya_), (xb_, yb_)) in enumerate(zip(pts, pts[1:])):
        u = Vector((xb_ - xa_, yb_ - ya_, 0.0))
        L = u.length
        u.normalize()
        nrm = Vector((0, 0, 1)).cross(u)
        xf = H.basis(u, nrm, (0, 0, 1), (xa_, ya_, 0.0))
        st = 0.0006 * (k % 2)
        mm.box((-0.0012, -0.0011, mz0 + st), (L + 0.0012, 0.0011, mz1 - st), "mat_filter", xf, bw=0.0)
    mm.to_object(scene, "filter_media", matrix=Matrix.Translation((x, 0.0, 0.75)), parent=fb, space="world")
    return fb


def build_dat_sensor(scene, x=DAT_X, zh=DAT_HEAD_Z):
    """Serpentine averaging element across the leaving-air section; its lead runs
    down the front wall to the head, mid-height on the outside of the front panel
    (clear of the CHW piping above and below it)."""
    runs, z_top, z_bot, y0, y1 = 7, 1.18, 0.32, -0.5, 0.5
    R = (z_top - z_bot) / (runs - 1) / 2
    ya, yb = y0 + R, y1 - R
    lead = piping.Route([(x, -0.625, zh), (x, -0.54, zh), (x, -0.54, z_top), (x, yb, z_top)], 0.03).pts
    pts = [p.copy() for p in lead]
    for i in range(runs):
        z = z_top - 2 * R * i
        d = 1 if i % 2 == 0 else -1
        end = yb if d > 0 else ya
        pts.append(Vector((x, end, z)))
        if i < runs - 1:
            for j in range(1, 9):
                a = math.pi / 2 - math.pi * j / 8
                pts.append(Vector((x, end + d * R * math.cos(a), z - R + R * math.sin(a))))
    clean = []
    for p in pts:
        if not clean or (p - clean[-1]).length > 1e-6:
            clean.append(p)
    mb = H.MeshBuilder()
    mb.tube(clean, 0.006, 8, "mat_sensor", bw=0.0)
    for sy in (1, -1):
        s0, s1 = sorted((sy * (y1 + 0.006), sy * (y1 + 0.012)))
        mb.box((x - 0.01, s0, IZ0 + 0.001), (x + 0.01, s1, IZ1 - 0.001), "mat_steel", bw=0.3)
    mb.to_object(scene, "dat_sensor", matrix=Matrix.Translation((x, 0.0, 0.75)), space="world", bevel=0.001,
                 segments=1)

    dz = zh - 1.18      # the economizer's head geometry, moved down to zh
    hb = H.MeshBuilder()
    hb.box((x - 0.04, -0.66, 1.13 + dz), (x + 0.04, Y0 + INSET - 0.001, 1.23 + dz), "mat_frame", bw=1.0)
    hb.box((x - 0.028, -0.6612, 1.19 + dz), (x + 0.028, -0.6595, 1.214 + dz), "mat_accent", bw=0.1)
    hb.box((x - 0.028, -0.6612, 1.172 + dz), (x + 0.004, -0.6595, 1.18 + dz), "mat_accent", bw=0.1)
    hb.cylinder((x, -0.63, 1.131 + dz), (x, -0.63, 1.112 + dz), 0.008, 12, "mat_dark", bw=0.3)
    hb.to_object(scene, "dat_sensor_head", matrix=Matrix.Translation((x, -0.629, zh)), space="world", bevel=0.006)


# --------------------------------------------------------------------------
# Coils, drain pan, trap
# --------------------------------------------------------------------------

def build_coils(scene):
    hw_fz0 = IZ0 + 0.001 + CHANNEL + 0.002
    hw_fz1 = IZ1 - 0.001 - CHANNEL - 0.002
    hw = coil.build(scene, "hw", HW_X, HW_D, FACE_W, hw_fz1 - hw_fz0, hw_fz0, rows=2, tubes=16,
                    header_r=HW["header_r"], conn_r=HW["rb"], conn_z=HW["conn_z"], conn_y=CONN_Y,
                    channel=CHANNEL, seal=SEAL, explode=(0.0, -1.1, 0.0))
    # the cooling coil stands in its drain pan: the casing's bottom member fills the pan
    # under the coil (pan floor up to the fin pack), so no air sneaks between pan and fins
    chw_fz0 = PAN_RIM + 0.013
    pan_in = IY1 - 0.004 - 0.003 - 0.001
    chw = coil.build(scene, "chw", CHW_X, CHW_D, FACE_W, hw_fz1 - chw_fz0, chw_fz0, rows=6, tubes=16,
                     header_r=CHW["header_r"], conn_r=CHW["rb"], conn_z=CHW["conn_z"], conn_y=CONN_Y,
                     channel=CHANNEL, seal=SEAL, bottom_seal=(-pan_in, pan_in, PAN_FLOOR + 0.0005),
                     explode=(0.0, -1.5, 0.0))
    return hw, chw


def build_drain(scene, chw):
    """Stainless drain pan under the CHW coil, outlet through the front panel into
    a P-trap that discharges onto a splash block on the deck."""
    y0, y1 = IY0 + 0.004, IY1 - 0.004
    t = 0.003
    mb = H.MeshBuilder()
    mb.box((PAN_X0, y0, PAN_Z0), (PAN_X1, y1, PAN_FLOOR), "mat_steel", bw=0.6)
    for ya, yb in ((y0, y0 + t), (y1 - t, y1)):
        mb.box((PAN_X0, ya, PAN_FLOOR), (PAN_X1, yb, PAN_RIM), "mat_steel", bw=0.6)
    for xa, xb in ((PAN_X0, PAN_X0 + t), (PAN_X1 - t, PAN_X1)):
        mb.box((xa, y0 + t, PAN_FLOOR), (xb, y1 - t, PAN_RIM), "mat_steel", bw=0.6)
    ox, oz = -0.56, PAN_FLOOR + 0.016
    mb.cylinder((ox, y0 + 0.001, oz), (ox, -0.612, oz), 0.012, 12, "mat_steel", bw=0.0)
    mb.cylinder((ox, -0.603, oz), (ox, -0.618, oz), 0.0165, 12, "mat_steel", bw=0.8)
    mb.to_object(scene, "chw_drain_pan", matrix=Matrix.Translation(((PAN_X0 + PAN_X1) / 2, 0.0, PAN_Z0 + 0.03)),
                 space="world", bevel=0.0015, segments=1)

    # P-trap in the front (XZ) plane: drop, U, rising leg, outlet arm turned down
    # over a splash block (indirect waste, air gap above the block)
    yt = -0.70
    rt = piping.Route([(ox, -0.614, oz), (ox, yt, oz), (ox, yt, 0.036), (ox - 0.08, yt, 0.036),
                       (ox - 0.08, yt, 0.15), (ox - 0.17, yt, 0.15), (ox - 0.17, yt, 0.075)],
                      [0.03, 0.04, 0.04, 0.03, 0.03])
    tb = H.MeshBuilder()
    tb.tube(rt.pts, 0.0125, 12, "mat_copper", bw=0.0)
    tb.cylinder((ox, yt, 0.085), (ox, yt, 0.115), 0.0155, 12, "mat_copper", bw=0.6)          # union
    tb.cylinder((ox - 0.17, yt, 0.071), (ox - 0.17, yt, 0.087), 0.0155, 12, "mat_copper", bw=0.6)
    tb.cylinder((ox - 0.08, yt, 0.108), (ox - 0.08, yt, 0.123), 0.0155, 12, "mat_copper", bw=0.6)  # cleanout tee
    tb.cylinder((ox - 0.08, yt - 0.012, 0.1155), (ox - 0.08, yt - 0.028, 0.1155), 0.009, 6, "mat_copper", bw=0.4)
    tb.box((ox - 0.06, yt - 0.02, 0.0), (ox - 0.02, yt + 0.02, 0.0235), "mat_dark", bw=0.5)      # support pad
    tb.box((ox - 0.23, yt - 0.06, 0.0), (ox - 0.11, yt + 0.045, 0.025), "mat_concrete", bw=0.8)  # splash block
    tb.to_object(scene, "chw_trap", matrix=Matrix.Translation((ox - 0.08, yt, 0.1)), space="world",
                 bevel=0.002, segments=1)


# --------------------------------------------------------------------------
# Piping trains
# --------------------------------------------------------------------------

def _fittings(scene, name, conns, rb, parent):
    """Pipe-side mating flanges + bare nipples at the coil connections."""
    mb = H.MeshBuilder()
    for c in conns:
        mb.cylinder((c.x, c.y - 0.001, c.z), (c.x, c.y - 0.013, c.z), rb + 0.022, 20, "mat_steel", bw=1.0)
        mb.cylinder((c.x, c.y - 0.012, c.z), (c.x, c.y - 0.012 - piping.INS_CLEAR - 0.012, c.z), rb, 12,
                    "mat_steel", bw=0.0)
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            px, pz = c.x + (rb + 0.022) * 0.78 * math.cos(a), c.z + (rb + 0.022) * 0.78 * math.sin(a)
            mb.cylinder((px, c.y + 0.004, pz), (px, c.y - 0.018, pz), 0.0035, 6, "mat_steel", bw=0.0)
    ctr = sum((c for c in conns), Vector()) / len(conns)
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world", bevel=0.0012,
                        segments=1)


def build_train(scene, p, spec, c, supply_corners, return_corners, fit, drive):
    """One coil's piping train. fit: positions of the fittings (world points on
    the routes) and lever directions."""
    asm = H.assembly(scene, "%s_piping" % p, (c.assembly.location.x, YP, 0.6))
    rb, ri, R = spec["rb"], spec["ri"], spec["bend"]
    sup = piping.Route(supply_corners, R)
    ret = piping.Route(return_corners, R)

    s_curb, zt = piping.curb(scene, "%s_supply_curb" % p, supply_corners[0][0], YP, ri, parent=asm)
    r_curb, _ = piping.curb(scene, "%s_return_curb" % p, return_corners[-1][0], YP, ri, parent=asm)
    z_ins = 0.09 + 0.012        # insulation starts just above the curb cap, inside the boot

    bv1, g1 = piping.ball_valve(scene, "%s_ball_valve_01" % p, sup, fit["bv1"], rb, up=fit.get("bv1_up", piping.UP),
                                lever=fit.get("bv1_lever", 1.0), parent=asm)
    bal, g2 = piping.balancing_valve(scene, "%s_balancing_valve" % p, sup, fit["bal"], rb, parent=asm)
    piping.thermometer(scene, "%s_thermometer_01" % p, sup, fit["t1"], ri, parent=asm)
    s0 = sup.s_of((supply_corners[0][0], YP, z_ins))
    s1 = sup.length - 0.012 - piping.INS_CLEAR
    piping.jacket(scene, "%s_supply_pipe" % p, sup, ri, gaps=[g1, g2], s0=s0, s1=s1, parent=asm)

    cv = piping.control_valve(scene, p, ret, fit["cv"], rb, drive, parent=asm)
    bv2, g3 = piping.ball_valve(scene, "%s_ball_valve_02" % p, ret, fit["bv2"], rb, up=piping.FRONT,
                                lever=fit.get("bv2_lever", 1.0), parent=asm)
    piping.thermometer(scene, "%s_thermometer_02" % p, ret, fit["t2"], ri, parent=asm)
    r0 = 0.012 + piping.INS_CLEAR
    r1 = ret.s_of((return_corners[-1][0], YP, z_ins))
    piping.jacket(scene, "%s_return_pipe" % p, ret, ri, gaps=[cv["gap"], g3], s0=r0, s1=r1, parent=asm)

    _fittings(scene, "%s_fittings" % p, [c.supply_conn, c.return_conn], rb, asm)

    # water flow paths along the pipe centerlines
    fs = sup.flow_points(sup.s_of((supply_corners[0][0], YP, 0.03)), sup.length)
    fr = ret.flow_points(0.0, ret.s_of((return_corners[-1][0], YP, 0.03)))
    H.flow_path(scene, "%ss" % p, fs, spread=(0.02, 0.02))
    H.flow_path(scene, "%sr" % p, fr, spread=(0.02, 0.02))
    return dict(assembly=asm, valve=cv, supply=sup, ret=ret, flows=(len(fs), len(fr)))


class _C:
    def __init__(self, d):
        self.__dict__.update(d)


def build_piping(scene, hw, chw):
    h, c = _C(hw), _C(chw)
    # HW train opens to the left of its coil
    hs, hr = h.supply_conn, h.return_conn
    zs, zr = hs.z, hr.z
    hw_t = build_train(
        scene, "hw", HW, h,
        [(-1.50, YP, 0.0), (-1.50, YP, zs), (hs.x, YP, zs), (hs.x, CONN_Y, zs)],
        [(hr.x, CONN_Y, zr), (hr.x, YP, zr), (-1.74, YP, zr), (-1.74, YP, 0.0)],
        dict(bv1=(-1.37, YP, zs), bv1_lever=-1.0, bal=(-1.20, YP, zs), t1=(-1.05, YP, zs),
             t2=(-1.11, YP, zr), cv=(-1.36, YP, zr), bv2=(-1.74, YP, 0.60)),
        "hwValvePos")
    # CHW train opens to the right of its coil
    cs, cr = c.supply_conn, c.return_conn
    zs, zr = cs.z, cr.z
    chw_t = build_train(
        scene, "chw", CHW, c,
        [(0.24, YP, 0.0), (0.24, YP, zs), (cs.x, YP, zs), (cs.x, CONN_Y, zs)],
        [(cr.x, CONN_Y, zr), (cr.x, YP, zr), (0.46, YP, zr), (0.46, YP, 0.0)],
        dict(bv1=(0.24, YP, 0.25), bv1_up=piping.FRONT, bal=(0.07, YP, zs), t1=(-0.08, YP, zs),
             t2=(-0.26, YP, zr), cv=(-0.05, YP, zr), bv2=(0.46, YP, 0.62)),
        "chwValvePos")
    return hw_t, chw_t


# --------------------------------------------------------------------------
# Fan, supply duct, site
# --------------------------------------------------------------------------

def build_fan(scene):
    fa = H.assembly(scene, "fan_assembly", FAN_C, explode=(0.0, -0.9, 0.0))
    fan.wheel(scene, "fan_wheel", FAN_C, diameter=0.6, width=0.2, blades=10, parent=fa)
    fan.inlet(scene, "fan_inlet", FAN_C, wall_x=FAN_WALL, overlap_x=FAN_C.x - 0.1 + 0.032, parent=fa)
    fan.wall(scene, "fan_wall", FAN_WALL, IY0 + 0.001, IY1 - 0.001, IZ0 + 0.001, IZ1 - 0.001, (0.0, FAN_C.z), 0.262,
             parent=fa)
    mx0, mx1 = FAN_C.x + 0.135, X1 - INSET - T - 0.037
    fan.motor(scene, "fan_motor", 0.0, FAN_C.z, x0=mx0, x1=mx1, shaft_from=FAN_C.x + 0.08, parent=fa)
    fan.base(scene, "fan_base", FAN_WALL + 0.06, mx1 - 0.01, IZ0 + 0.001, 0.64, mx0 + 0.015, mx1 - 0.07, parent=fa)
    return fa


def build_duct(scene):
    sd = H.assembly(scene, "sa_duct", ((X1 + WALL_X) / 2, 0.0, 0.75), explode=(0.0, -0.75, 0.0))
    housing.rect_duct(scene, "sa_duct", X1 - INSET - T + 0.003, WALL_X, -0.4, 0.4, 0.35, 1.15, t=T, parent=sd)
    housing.flange_ring(scene, "sa_duct_flange", [(X1 - INSET + 0.001, X1 + 0.018), (WALL_X - 0.02, WALL_X)],
                        -0.4, 0.4, 0.35, 1.15, 0.03, parent=sd)
    return sd


def build_site(scene):
    st = H.assembly(scene, "site", (0.0, 0.0, 0.0))
    wall_layers = [(0.03, "mat_wall"), (0.10, "mat_insulation"), (0.22, "mat_concrete")]
    x1 = WALL_X + sum(t for t, _ in wall_layers)
    y0, y1 = -1.35, 1.25
    site.deck(scene, "site_deck", X0, x1, y0, y1,
              [(0.025, "mat_deck"), (0.12, "mat_insulation"), (0.17, "mat_concrete"), (0.05, "mat_frame")],
              parent=st)
    # walkway pads out front, clear of the pipe curbs (y > -0.84) and the trap's splash block
    site.pavers(scene, "site_pavers", [(-1.84 + 0.66 * k, -1.09) for k in range(6)], 0.6, 0.44, parent=st)
    site.wall(scene, "site_wall", WALL_X, y0, y1, 0.0, 2.75, wall_layers,
              openings=[(-0.4, 0.4, 0.35, 1.15)], cap=(0.04, "mat_frame"), parent=st)
    return st


# --------------------------------------------------------------------------
# Air flow fallback, condensate, anchors
# --------------------------------------------------------------------------

def build_air_flow(scene):
    fx = FAN_C.x
    H.flow_path(scene, "air",
                [(X0, 0.75), (FILTER_X, 0.75), (HW_X, 0.75), (CHW_X, 0.76), (DAT_X, 0.75), (FAN_WALL - 0.08, 0.75),
                 (FAN_WALL + 0.10, 0.75), (fx + 0.01, 0.76), (fx + 0.02, 1.13), (fx + 0.27, 1.20), (X1 + 0.05, 0.90),
                 (1.9, 0.76), (WALL_X, 0.75)],
                spread=[(0.45, 0.4), (0.45, 0.4), (0.45, 0.4), (0.45, 0.4), (0.45, 0.4), (0.14, 0.14),
                        (0.12, 0.12), (0.1, 0.06), (0.2, 0.05), (0.3, 0.08), (0.33, 0.1), (0.33, 0.33), (0.35, 0.35)])


def build_condensate(scene, chw):
    """Drops leave the fin pack's bottom leaving edge; they fall just past the
    casing's leaving face (the bottom member fills the pan under the coil) into
    the open pan downstream."""
    fx0, fx1, fy0, fy1, fz0, fz1 = chw["face"]
    xd = chw["leaving_x"] + 0.004
    a = H.empty(scene, "drip_a", (xd, fy0 + 0.01, fz0), size=0.03, display="SPHERE")
    b = H.empty(scene, "drip_b", (xd, fy1 - 0.01, fz0), size=0.03, display="SPHERE")
    # on the water surface right below the middle of the drip line (open pan, downstream of the coil)
    pan = H.empty(scene, "drip_pan", (xd, 0.0, WATER_Z), size=0.03, display="SPHERE")
    return a, b, pan


def build_anchors(scene, hw_t, chw_t):
    H.anchor(scene, "eat", (X0 + 0.08, -0.35, 1.12))
    # coil readouts sit in the air just leaving each coil, toward the back, clear of the valve callouts up top
    H.anchor(scene, "hw", (HW_X + HW_D / 2 + 0.06, 0.3, 0.9))
    H.anchor(scene, "chw", (CHW_X + CHW_D / 2 + 0.06, 0.3, 1.0))
    H.anchor(scene, "dat", (DAT_X, -0.66, DAT_HEAD_Z + 0.09))
    for p, t in (("hw", hw_t), ("chw", chw_t)):
        top = t["valve"]["top"]
        H.anchor(scene, "%s_valve" % p, (top.x, top.y, top.z + 0.05))
    H.anchor(scene, "sa", (2.2, -0.3, 1.2))
    H.anchor(scene, "pan", ((CHW_X + CHW_D / 2 + PAN_X1) / 2, -0.56, PAN_RIM + 0.03))
    H.anchor(scene, "fan", (FAN_C.x, -0.3, 1.1))


def build(scene):
    H.ensure_materials()
    build_housing(scene)
    build_filter(scene)
    hw, chw = build_coils(scene)
    build_drain(scene, chw)
    build_dat_sensor(scene)
    build_fan(scene)
    build_duct(scene)
    build_site(scene)
    hw_t, chw_t = build_piping(scene, hw, chw)
    build_air_flow(scene)
    build_condensate(scene, chw)
    build_anchors(scene, hw_t, chw_t)
    return {"drives": DRIVES, "require": REQUIRE}
