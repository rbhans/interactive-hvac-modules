"""Economizer teaching module: mixing box + plug-fan section with OA / RA /
relief dampers, return duct and supply duct stub.

Layout (Blender Z-up, meters, front = -Y, air flows left -> right):

   relief <-[EA dmpr]====== return duct ======== <- RA from building
                   || RA dmpr (horizontal, in unit roof)
   OA -> [OA dmpr] mixing box | MAT | filter | fan bulkhead + plug fan | -> supply duct ->
"""
import math

from mathutils import Matrix, Vector

import hvaclab as H
from parts import damper, fan, housing, site

DRIVES = ["oaBladePos", "raBladePos", "eaBladePos", "actuatorPos", "fanSpeed"]

# unit envelope
X0, X1 = -1.2, 1.4
Y0, Y1 = -0.6, 0.6
Z0, Z1 = 0.15, 1.35
T = 0.03            # panel thickness
INSET = 0.003       # panels sit 3 mm inside the edge framing (reveal, no z-fighting)
EDGE = 0.035        # edge framing bar size
DDEPTH = 0.12       # damper channel depth
XP = X0 + DDEPTH / 2    # -1.14: panels start at the inner face of the end dampers

# interior faces
IY0, IY1 = Y0 + INSET + T, Y1 - INSET - T      # -0.567 / 0.567
IZ0, IZ1 = Z0 + INSET + T, Z1 - INSET - T      # 0.183 / 1.317

FAN_C = Vector((0.85, 0.0, 0.75))
CRANK_Y = -0.66
ARM_DIR = Vector((-1.0, 0.0, -1.0)).normalized()   # 7:30 at rest -> 10:30 open (front view)

REQUIRE = [
    "housing_back", "housing_floor", "housing_roof", "housing_front", "housing_end", "housing_edges",
    "base_rail_01", "base_rail_02",
    "oa_damper", "oa_frame", "oa_blade_01", "oa_blade_02", "oa_blade_03", "oa_blade_04", "oa_blade_05", "oa_blade_06",
    "ea_damper", "ea_frame", "ea_blade_01", "ea_blade_02", "ea_blade_03", "ea_blade_04",
    "ra_damper", "ra_frame", "ra_blade_01", "ra_blade_02", "ra_blade_03", "ra_blade_04",
    "ra_duct", "sa_duct",
    "fan_assembly", "fan_wheel", "fan_inlet", "fan_wall", "fan_motor", "fan_base",
    "filter_bank", "mat_sensor", "mat_sensor_head",
    "oa_crank", "oa_crank_pin", "oa_actuator", "oa_actuator_hub", "ea_crank", "ea_crank_pin", "link_rod_01",
    "anchor_oa", "anchor_ea", "anchor_ra", "anchor_mat", "anchor_actuator", "anchor_fan", "anchor_sa",
    "flow_oa_00", "flow_ra_00", "flow_ea_00", "flow_ma_00",
    "site", "site_deck", "site_wall", "site_pavers",
]


def build_housing(scene):
    hs = H.assembly(scene, "housing", ((X0 + X1) / 2, 0.0, (Z0 + Z1) / 2))
    xa, xb = XP, X1 - EDGE
    inside = ((X0 + X1) / 2, 0.0, (Z0 + Z1) / 2)   # interior faces get the dark liner
    housing.panel(scene, "housing_back", (xa, Y1 - INSET - T, Z0 + EDGE), (xb, Y1 - INSET, Z1 - EDGE), parent=hs, inner=inside)
    front = housing.panel(scene, "housing_front", (xa, Y0 + INSET, Z0 + EDGE), (xb, Y0 + INSET + T, Z1 - EDGE),
                          parent=hs, inner=inside)
    H.set_cutaway(front)
    H.set_explode(front, (0.0, -1.3, 0.0))
    housing.panel(scene, "housing_roof", (xa, Y0 + EDGE, IZ1), (xb, Y1 - EDGE, Z1 - INSET),
                  hole=("rect", -0.95, -0.15, -0.45, 0.45), parent=hs, inner=inside)
    housing.panel(scene, "housing_floor", (xa, Y0 + EDGE, Z0 + INSET), (xb, Y1 - EDGE, IZ0), parent=hs, inner=inside)
    housing.panel(scene, "housing_end", (X1 - INSET - T, Y0 + EDGE, Z0 + EDGE), (X1 - INSET, Y1 - EDGE, Z1 - EDGE),
                  hole=("rect", -0.4, 0.4, 0.35, 1.15), parent=hs, inner=inside)
    housing.edge_frame(scene, "housing_edges", (X0, Y0, Z0), (X1, Y1, Z1), EDGE, x_start=XP, parent=hs)
    housing.base_rail(scene, "base_rail_01", X0, X1, -0.42, outward=-1, height=Z0 + INSET, parent=hs)
    housing.base_rail(scene, "base_rail_02", X0, X1, 0.42, outward=1, height=Z0 + INSET, parent=hs)
    return hs


def build_dampers(scene):
    oa = damper.build(scene, "oa", (X0, 0.0, 0.75), (0, 1, 0), (0, 0, 1), 1.2, 1.2, 6, opposed=True,
                      drive="oaBladePos", drive_blade=3, drive_shaft=0.82, explode=(-0.7, 0.0, 0.0),
                      frame=dict(depth=DDEPTH))
    ea = damper.build(scene, "ea", (X0, 0.0, 1.70), (0, 1, 0), (0, 0, 1), 0.9, 0.7, 4, opposed=True,
                      drive="eaBladePos", drive_blade=1, drive_shaft=-CRANK_Y + 0.02, explode=(-0.7, 0.0, 0.35),
                      frame=dict(depth=DDEPTH))
    ra = damper.build(scene, "ra", (-0.55, 0.0, Z1 - INSET - DDEPTH / 2), (0, 1, 0), (1, 0, 0), 0.9, 0.8, 4,
                      opposed=True, drive="raBladePos", drive_blade=0, explode=(0.0, 0.0, 0.45),
                      frame=dict(depth=DDEPTH))

    # --- OA drive: crank + direct-coupled actuator on blade 03's shaft ---------
    b3 = 2
    sign3 = oa["signs"][b3]
    z3 = oa["centers"][b3].z
    oa_crank, oa_pin = damper.crank(scene, "oa_crank", (X0, CRANK_Y, z3), (0, 1, 0), ARM_DIR, 0.1,
                                    "oaBladePos", (0.0, 90.0 * sign3), parent=oa["assembly"])
    act = damper.actuator(scene, "oa_actuator", (X0, 0.0, z3), front_face_y=-0.80, back_face_y=-0.71,
                          strap_to_y=Y0, parent=oa["assembly"])
    damper.actuator_hub(scene, "oa_actuator_hub", (X0, -0.80, z3), drives="actuatorPos",
                        rng=(0.0, 90.0 * sign3), parent=act)

    # --- relief drive crank on ea_blade_01 (same rotation sense -> parallelogram)
    signe = ea["signs"][0]
    ze = ea["centers"][0].z
    ea_crank, ea_pin = damper.crank(scene, "ea_crank", (X0, CRANK_Y, ze), (0, 1, 0), ARM_DIR, 0.1,
                                    "eaBladePos", (0.0, 90.0 * signe), parent=ea["assembly"])

    # --- link rod (not parented to the cranks; the runtime re-aims it)
    damper.link_rod(scene, "link_rod_01", oa_pin, ea_pin, pin_axis=(0, 1, 0))
    return oa, ea, ra, z3


def build_fan(scene):
    fa = H.assembly(scene, "fan_assembly", FAN_C, explode=(0.0, -0.9, 0.0))
    fan.wheel(scene, "fan_wheel", FAN_C, diameter=0.6, width=0.2, blades=10, parent=fa)
    fan.inlet(scene, "fan_inlet", FAN_C, wall_x=0.60, parent=fa)
    fan.wall(scene, "fan_wall", 0.60, IY0 + 0.001, IY1 - 0.001, IZ0 + 0.001, IZ1 - 0.001, (0.0, FAN_C.z), 0.262,
             parent=fa)
    fan.motor(scene, "fan_motor", 0.0, FAN_C.z, parent=fa)
    fan.base(scene, "fan_base", 0.66, 1.32, IZ0 + 0.001, 0.64, 1.0, 1.26, parent=fa)
    return fa


def build_filter(scene, x=0.30, depth=0.10, member=0.035):
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
    # pleated media: each pleat face is a thin slab (overlapping at the folds)
    mm = H.MeshBuilder()
    mz0, mz1 = z0 + member - 0.002, z1 - member + 0.002
    xf0, xf1 = xa + 0.012, xb - 0.012
    for by0, by1 in ((y0 + member, y1 - member),):
        n = int(round((by1 - by0) / 0.034))
        step = (by1 - by0 - 0.004) / (2 * n)
        pts = [(xf0 if k % 2 == 0 else xf1, by0 + 0.002 + k * step) for k in range(2 * n + 1)]
        for k, ((xa_, ya_), (xb_, yb_)) in enumerate(zip(pts, pts[1:])):
            u = Vector((xb_ - xa_, yb_ - ya_, 0.0))
            L = u.length
            u.normalize()
            nrm = Vector((0, 0, 1)).cross(u)
            xf = H.basis(u, nrm, (0, 0, 1), (xa_, ya_, 0.0))
            st = 0.0006 * (k % 2)   # stagger end caps so overlapping folds never share a plane
            mm.box((-0.0012, -0.0011, mz0 + st), (L + 0.0012, 0.0011, mz1 - st), "mat_filter", xf, bw=0.0)
    mm.to_object(scene, "filter_media", matrix=Matrix.Translation((x, 0.0, 0.75)), parent=fb, space="world")
    return fb


def build_sensor(scene, x=0.08):
    """Serpentine averaging element strung across the mixed-air section and its
    head on the outside of the front panel."""
    runs, z_top, z_bot, y0, y1 = 7, 1.18, 0.32, -0.5, 0.5
    R = (z_top - z_bot) / (runs - 1) / 2
    ya, yb = y0 + R, y1 - R
    pts = [Vector((x, -0.625, z_top))]
    for i in range(runs):
        z = z_top - 2 * R * i
        d = 1 if i % 2 == 0 else -1
        end = yb if d > 0 else ya
        pts.append(Vector((x, end, z)))
        if i < runs - 1:
            for j in range(1, 9):
                a = math.pi / 2 - math.pi * j / 8
                pts.append(Vector((x, end + d * R * math.cos(a), z - R + R * math.sin(a))))
    mb = H.MeshBuilder()
    mb.tube(pts, 0.006, 8, "mat_sensor", bw=0.0)
    for sy in (1, -1):
        s0, s1 = sorted((sy * (y1 + 0.006), sy * (y1 + 0.012)))
        mb.box((x - 0.01, s0, IZ0 + 0.001), (x + 0.01, s1, IZ1 - 0.001), "mat_steel", bw=0.3)
    mb.to_object(scene, "mat_sensor", matrix=Matrix.Translation((x, 0.0, 0.75)), space="world", bevel=0.001,
                 segments=1)

    head_c = Vector((x, -0.629, 1.18))
    hb = H.MeshBuilder()
    hb.box((x - 0.04, -0.66, 1.13), (x + 0.04, Y0 + INSET - 0.001, 1.23), "mat_frame", bw=1.0)
    hb.box((x - 0.028, -0.6612, 1.19), (x + 0.028, -0.6595, 1.214), "mat_accent", bw=0.1)
    hb.box((x - 0.028, -0.6612, 1.172), (x + 0.004, -0.6595, 1.18), "mat_accent", bw=0.1)
    hb.cylinder((x, -0.63, 1.131), (x, -0.63, 1.112), 0.008, 12, "mat_dark", bw=0.3)
    hb.to_object(scene, "mat_sensor_head", matrix=Matrix.Translation(head_c), space="world", bevel=0.006)


def build_ducts(scene):
    rd = H.assembly(scene, "ra_duct", (0.7, 0.0, 1.7), explode=(0.0, 0.0, 0.9))
    top_of_roof = Z1 - INSET
    housing.rect_duct(scene, "ra_duct", XP, 2.6, -0.45, 0.45, top_of_roof, 2.05, t=T, bottom_x=(X1, 2.6),
                      side_z0=top_of_roof, parent=rd)
    housing.flange_ring(scene, "ra_duct_flange", [(2.58, 2.6)], -0.45, 0.45, top_of_roof, 2.05, 0.03, parent=rd)

    # explodes toward the viewer: +X would drive it into the penthouse wall
    sd = H.assembly(scene, "sa_duct", (2.0, 0.0, 0.75), explode=(0.0, -0.75, 0.0))
    housing.rect_duct(scene, "sa_duct", X1 - INSET - T + 0.003, 2.6, -0.4, 0.4, 0.35, 1.15, t=T, parent=sd)
    housing.flange_ring(scene, "sa_duct_flange", [(X1 - INSET + 0.001, X1 + 0.018), (2.58, 2.6)],
                        -0.4, 0.4, 0.35, 1.15, 0.03, parent=sd)
    return rd, sd


def build_flows(scene):
    H.flow_path(scene, "oa", [(-2.3, 0.75), (-1.6, 0.75), (-1.2, 0.75), (-0.8, 0.72), (-0.35, 0.7)],
                spread=(0.5, 0.45))
    H.flow_path(scene, "ra",
                [(2.7, 1.7), (1.4, 1.7), (0.0, 1.7), (-0.45, 1.62), (-0.55, 1.35), (-0.5, 1.0), (-0.35, 0.75)],
                spread=[(0.35, 0.25), (0.35, 0.25), (0.35, 0.25), (0.35, 0.22), (0.35, 0.22), (0.4, 0.3),
                        (0.45, 0.35)])
    H.flow_path(scene, "ea", [(2.7, 1.7), (1.4, 1.7), (-0.2, 1.72), (-1.2, 1.7), (-2.2, 1.75)],
                spread=(0.35, 0.25))
    # mixed air: through filter, into the inlet cone, radially out of the wheel,
    # over the motor and down into the supply duct (never through solids)
    H.flow_path(scene, "ma",
                [(-0.35, 0.72), (0.05, 0.75), (0.30, 0.75), (0.52, 0.75), (0.68, 0.75), (0.86, 0.76),
                 (0.87, 1.13), (1.12, 1.20), (1.45, 0.90), (2.0, 0.76), (2.7, 0.75)],
                spread=[(0.45, 0.4), (0.45, 0.4), (0.45, 0.4), (0.14, 0.14), (0.12, 0.12), (0.1, 0.06),
                        (0.2, 0.05), (0.3, 0.08), (0.33, 0.1), (0.33, 0.33), (0.35, 0.35)])


WALL_X = 2.6        # penthouse wall face; the ducts end in it


def build_site(scene):
    """Roof-deck section under the unit and the penthouse wall the ducts run into.
    Cut like an architectural section so the build-up shows on the edges."""
    st = H.assembly(scene, "site", (0.0, 0.0, 0.0))
    wall_layers = [(0.03, "mat_wall"), (0.10, "mat_insulation"), (0.22, "mat_concrete")]
    x1 = WALL_X + sum(t for t, _ in wall_layers)
    y0, y1 = -1.35, 1.25
    site.deck(scene, "site_deck", -2.55, x1, y0, y1,
              [(0.025, "mat_deck"), (0.12, "mat_insulation"), (0.17, "mat_concrete"), (0.05, "mat_frame")],
              parent=st)
    site.pavers(scene, "site_pavers", [(-1.0 + 0.66 * k, -0.95) for k in range(4)], 0.6, 0.5, parent=st)
    site.wall(scene, "site_wall", WALL_X, y0, y1, 0.0, 2.75, wall_layers,
              openings=[(-0.45, 0.45, Z1 - INSET, 2.05), (-0.4, 0.4, 0.35, 1.15)],
              cap=(0.04, "mat_frame"), parent=st)
    return st


def build_anchors(scene, z3):
    H.anchor(scene, "oa", (-1.45, -0.5, 1.2))
    H.anchor(scene, "ea", (-1.45, -0.35, 1.95))
    H.anchor(scene, "ra", (2.3, -0.3, 2.12))
    H.anchor(scene, "mat", (0.08, -0.63, 1.30))
    H.anchor(scene, "actuator", (-1.135, -0.755, z3 + 0.11))
    H.anchor(scene, "fan", (0.85, -0.3, 1.1))
    H.anchor(scene, "sa", (2.3, -0.3, 1.2))


def build(scene):
    H.ensure_materials()
    build_housing(scene)
    oa, ea, ra, z3 = build_dampers(scene)
    build_fan(scene)
    build_filter(scene)
    build_sensor(scene)
    build_ducts(scene)
    build_site(scene)
    build_flows(scene)
    build_anchors(scene, z3)
    return {"drives": DRIVES, "require": REQUIRE}
