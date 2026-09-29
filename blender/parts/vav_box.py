"""Single-duct, pressure-independent VAV terminal.

World axes: air flows +X along the round inlet's axis (y = 0, z = zc). The
butterfly damper's shaft runs along world Y and pokes out the front (-Y) into
a combined DDC controller / actuator (Belimo- or VMA-style) clamped on it.

Moving parts pivot on the shaft axis with local X along the shaft (world +Y):
  <blade>  rotates about local X; at 0 deg it lies in the YZ plane and closes
           the collar against two half-ring stops, at +90 deg it lies flat
           (XY plane). The stops sit on opposite sides of the blade plane (top
           half upstream, bottom half downstream), so the blade swings away
           from both when it opens.
  <hub>    the actuator's shaft clamp / position disc on the controller face,
           same axis and sense: its white pointer shows the blade's top edge
           (12 o'clock closed, 3 o'clock open, seen from the front).
"""
from mathutils import Matrix, Vector

import hvaclab as H
from parts import ductwork as D
from parts import piping

SEG = 24


def inlet(scene, name, x0, x1, zc, r_in, r_out, blade_x, stop_r=0.105, parent=None):
    """Round inlet collar x0..x1 (x1 pokes through the casing's end panel),
    with a draw band over the slip joint at x0, the damper's blade stops and
    shaft bushings."""
    mb = H.MeshBuilder()
    xf = Matrix.Translation((0.0, 0.0, zc))
    D.tube_wall(mb, x0, x1, r_in, r_out, SEG, "mat_duct", xf, bw=0.6)
    D.lathe(mb, [(x0 - 0.022, r_out), (x0 + 0.014, r_out), (x0 + 0.014, r_out + 0.0035), (x0 - 0.022, r_out + 0.0035)],
            SEG, "mat_steel", xf, bw=0.5)
    # blade stops, embedded a millimetre in the collar wall; they clear the shaft by ~8 mm
    D.arc_ring(mb, blade_x - 0.009, blade_x - 0.0035, stop_r, r_in + 0.001, 8.0, 172.0, 12, "mat_duct", xf, bw=0.3)
    D.arc_ring(mb, blade_x + 0.0035, blade_x + 0.009, stop_r, r_in + 0.001, 188.0, 352.0, 12, "mat_duct", xf, bw=0.3)
    for sy in (1, -1):
        y0, y1 = sorted((sy * (r_in + 0.0005), sy * (r_out + 0.011)))
        mb.cylinder((blade_x, y0, zc), (blade_x, y1, zc), 0.013, 12, "mat_dark", bw=0.4)
    return mb.to_object(scene, name, matrix=Matrix.Translation(((x0 + x1) / 2, 0.0, zc)), parent=parent,
                        space="world", bevel=0.0015, segments=1)


def flow_cross(scene, name, x, zc, r_in, tube_r=0.007, parent=None):
    """Multi-point averaging flow sensor: two perpendicular tubes spanning the
    collar's bore (ends seated in the wall) and a center hub."""
    mb = H.MeshBuilder()
    L = r_in + 0.002
    mb.cylinder((x, -L, zc), (x, L, zc), tube_r, 10, "mat_sensor", bw=0.0)
    mb.cylinder((x, 0.0, zc - L), (x, 0.0, zc + L), tube_r, 10, "mat_sensor", bw=0.0)
    mb.cylinder((x - 0.016, 0.0, zc), (x + 0.016, 0.0, zc), 0.017, 16, "mat_sensor", bw=0.6)
    return mb.to_object(scene, name, matrix=Matrix.Translation((x, 0.0, zc)), parent=parent, space="world",
                        bevel=0.001, segments=1)


def sense_tubes(scene, name, x, r_out, zs, port_x, port_y, parent=None):
    """The flow cross's high/low pickups: brass barbs on the front of the collar
    at (x, z in zs) and two thin dark tubes running forward, then along +X to
    the controller's ports at (port_x, port_y, z)."""
    mb = H.MeshBuilder()
    for z in zs:
        mb.cylinder((x, -(r_out - 0.006), z), (x, -(r_out + 0.008), z), 0.0055, 6, "mat_valve", bw=0.5)
        mb.cylinder((x, -(r_out + 0.007), z), (x, -(r_out + 0.019), z), 0.0022, 8, "mat_valve", bw=0.0)
        rt = piping.Route([(x, -(r_out + 0.011), z), (x, port_y, z), (port_x - 0.004, port_y, z)], 0.02)
        mb.tube(rt.pts, 0.003, 8, "mat_dark", bw=0.0)
    ctr = Vector(((x + port_x) / 2, (-(r_out + 0.011) + port_y) / 2, sum(zs) / len(zs)))
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world")


def damper_blade(scene, name, x, zc, r, t, shaft_y0, shaft_y1, drive, rng, parent=None):
    """Round butterfly blade with its shaft (world y from shaft_y0 to shaft_y1).
    Origin on the shaft at the blade center; local X = world +Y (the shaft),
    local Y = world +Z, local Z = world +X (the blade's normal when closed)."""
    M = H.shaft_basis((0, 1, 0), (0, 0, 1), (x, 0.0, zc))
    mb = H.MeshBuilder()
    mb.extrude(H.circle_pts(r, 32), -t / 2, t / 2, "mat_blade", bw=1.0)
    mb.cylinder((shaft_y0, 0, 0), (shaft_y1, 0, 0), 0.006, 12, "mat_steel", bw=0.0)
    for bx in (-0.045, 0.045):      # clamp bolts through blade and shaft
        mb.cylinder((bx, 0, -t / 2 - 0.003), (bx, 0, t / 2 + 0.003), 0.0055, 6, "mat_steel", bw=0.3)
    obj = mb.to_object(scene, name, matrix=M, parent=parent, bevel=0.001, segments=1)
    H.set_motion(obj, "rotate", rng, drive)
    return obj


def controller(scene, name, lo, hi, shaft_x, zc, port_zs, port_y, bracket_to_y, parent=None):
    """Static controller-actuator body lo..hi (lo.y = front face), mat_actuator,
    with a dark controller face (LEDs, label), 0 / 90 deg scale ticks around the
    shaft, a terminal strip on top, pressure ports on the -X end for the sense
    tubes, a shaft collar at the back and an anti-rotation bracket that ends at
    bracket_to_y (inside the inlet collar's wall)."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    mb = H.MeshBuilder()
    mb.box(lo, hi, "mat_actuator", bw=1.0)
    fy0, fy1 = y0 - 0.0015, y0 + 0.001
    mb.box((x0 + 0.006, fy0, z0 + 0.006), (shaft_x - 0.038, fy1, z1 - 0.006), "mat_frame", bw=0.2)
    ly0, ly1 = fy0 - 0.001, fy0 + 0.0005
    for zz in (z1 - 0.024, z1 - 0.036):
        mb.box((x0 + 0.017, ly0, zz - 0.003), (x0 + 0.023, ly1, zz + 0.003), "mat_accent", bw=0.1)
    mb.box((x0 + 0.015, ly0, z0 + 0.018), (x0 + 0.065, ly1, z0 + 0.030), "mat_accent", bw=0.1)
    ty0, ty1 = y0 - 0.0012, y0 + 0.0005
    mb.box((shaft_x - 0.0015, ty0, zc + 0.041), (shaft_x + 0.0015, ty1, zc + 0.050), "mat_accent", bw=0.1)
    mb.box((shaft_x + 0.041, ty0, zc - 0.0015), (shaft_x + 0.050, ty1, zc + 0.0015), "mat_accent", bw=0.1)
    # terminal strip on top
    ta, tb = x0 + 0.010, x0 + 0.070
    mb.box((ta, y0 + 0.013, z1 - 0.001), (tb, y0 + 0.031, z1 + 0.011), "mat_dark", bw=0.3)
    for k in range(5):
        sx = ta + 0.006 + k * (tb - ta - 0.012) / 4
        mb.cylinder((sx, y0 + 0.022, z1 + 0.0105), (sx, y0 + 0.022, z1 + 0.014), 0.0028, 6, "mat_steel", bw=0.0)
    # pressure ports (-X end) where the sense tubes connect
    for z in port_zs:
        mb.cylinder((x0 + 0.001, port_y, z), (x0 - 0.004, port_y, z), 0.0045, 6, "mat_valve", bw=0.4)
        mb.cylinder((x0 - 0.003, port_y, z), (x0 - 0.014, port_y, z), 0.002, 8, "mat_valve", bw=0.0)
    # cable gland underneath
    mb.cylinder((x0 + 0.05, (y0 + y1) / 2, z0 + 0.001), (x0 + 0.05, (y0 + y1) / 2, z0 - 0.012), 0.008, 10,
                "mat_dark", bw=0.3)
    # shaft collar where the shaft enters the back, anti-rotation bracket to the collar
    xf = H.basis((0, 1, 0), (0, 0, 1), (1, 0, 0), (shaft_x, 0.0, zc))
    D.lathe(mb, [(y1 - 0.0005, 0.0062), (y1 + 0.010, 0.0062), (y1 + 0.010, 0.013), (y1 - 0.0005, 0.013)], 16,
            "mat_dark", xf, bw=0.4)
    mb.box((x0 + 0.023, y1 - 0.0005, zc - 0.02), (x0 + 0.035, bracket_to_y, zc + 0.02), "mat_steel", bw=0.4)
    ctr = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    return mb.to_object(scene, name, matrix=Matrix.Translation(ctr), parent=parent, space="world", bevel=0.006,
                        segments=2)


def hub(scene, name, shaft_x, front_y, zc, drive, rng, radius=0.028, thickness=0.013, parent=None):
    """Rotating shaft clamp / position disc on the controller's front face
    (front_y; the disc stands 0.5 mm proud of it). Origin on the shaft at the
    disc center, local X = world +Y, the white pointer along local +Y (world +Z
    at 0 deg)."""
    p = Vector((shaft_x, front_y - 0.0005 - thickness / 2, zc))
    M = H.shaft_basis((0, 1, 0), (0, 0, 1), p)
    t2 = thickness / 2
    mb = H.MeshBuilder()
    mb.cylinder((-t2, 0, 0), (t2, 0, 0), radius, 28, "mat_dark", bw=0.25)
    mb.cylinder((-t2 - 0.005, 0, 0), (-t2 + 0.001, 0, 0), 0.009, 6, "mat_steel", bw=0.5)
    mb.box((-t2 - 0.0022, 0.0095, -0.0024), (-t2 + 0.0004, radius + 0.012, 0.0024), "mat_accent", bw=0.1)
    # short tail opposite the pointer so the clamp reads as one rotating piece
    mb.box((-t2 - 0.0016, -radius + 0.006, -0.003), (-t2 + 0.0004, -0.0095, 0.003), "mat_steel", bw=0.1)
    obj = mb.to_object(scene, name, matrix=M, parent=parent, bevel=0.002)
    H.set_motion(obj, "rotate", rng, drive)
    return obj


def casing(scene, name, lo, hi, t, zc, inlet_r, outlet, parent=None, front_explode=None):
    """Lined box body lo..hi: top, bottom, back and both end panels in one mesh
    (the inlet end has a round hole for the collar, the outlet end the
    rectangular opening `outlet` = (y0, y1, z0, z1)), plus the cutaway front
    panel `<name>_front`. Returns (casing, front)."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    inner = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    mb = H.MeshBuilder()
    D.panel(mb, (x0, y0, z1 - t), (x1, y1, z1))
    D.panel(mb, (x0, y0, z0), (x1, y1, z0 + t))
    D.panel(mb, (x0, y1 - t, z0 + t), (x1, y1, z1 - t))
    D.panel(mb, (x0, y0 + t, z0 + t), (x0 + t, y1 - t, z1 - t), hole=("circle", 0.0, zc, inlet_r, SEG))
    D.panel(mb, (x1 - t, y0 + t, z0 + t), (x1, y1 - t, z1 - t), hole=("rect",) + tuple(outlet))
    for axis in range(3):
        mb.line_interior(axis, inner)
    # nameplate on the top
    mb.box((x1 - 0.30, y0 + 0.08, z1 - 0.0005), (x1 - 0.14, y0 + 0.18, z1 + 0.001), "mat_accent", bw=0.1)
    body = mb.to_object(scene, name, matrix=Matrix.Translation(inner), parent=parent, space="world", bevel=0.003,
                        segments=1)
    fb = H.MeshBuilder()
    D.panel(fb, (x0, y0, z0 + t), (x1, y0 + t, z1 - t))
    fb.line_interior(1, inner)
    front = fb.to_object(scene, name + "_front", matrix=Matrix.Translation(((x0 + x1) / 2, y0 + t / 2, (z0 + z1) / 2)),
                         parent=parent, space="world", bevel=0.003, segments=1)
    H.set_cutaway(front)
    if front_explode is not None:
        H.set_explode(front, front_explode)
    return body, front
