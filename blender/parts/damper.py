"""Parametric opposed/parallel-blade damper + its drive accessories.

Damper-local axes: s = shaft axis, c = chord axis (blades stack along it),
n = s x c (flow direction / frame depth). Blades are closed at 0 deg (chord in
the damper plane, neighbours overlapping slightly) and open by rotating about
their local X (= s).
"""
import math

from mathutils import Matrix, Vector

import hvaclab as H

FRAME = dict(
    depth=0.12,      # channel depth along n
    web=0.006,       # sheet thickness
    head_lip=0.015,  # head/sill return lip (kept short so blade tips clear it)
    jamb_lip=0.025,  # jamb return lip
    clear=0.004,     # blade-tip clearance to head/sill web
    end_clear=0.008,  # blade-end clearance to jamb lips
    overlap=0.012,   # chord overlap between neighbouring closed blades
)
SHAFT_R = 0.006
SHAFT_POKE = 0.008


def _blade_profile(chord, crimp=1.0, samples=7):
    """Closed (chord, normal) polygon: lens-thick in the middle, thin Z-crimped
    edges (+c edge offset to +n, -c edge to -n) so closed neighbours overlap
    without touching and opposed pairs swing past each other."""
    h = chord / 2
    e = 0.005 * crimp
    t_mid, t_edge = max(0.013, 0.075 * chord), 0.003
    top, bot = [], []
    for i in range(samples):
        y = -h + 2 * h * i / (samples - 1)
        zc = e * (y / h) ** 3
        t = t_edge + (t_mid - t_edge) * math.cos(0.5 * math.pi * y / h)
        top.append((y, zc + t / 2))
        bot.append((y, zc - t / 2))
    return top + list(reversed(bot))


def build(scene, prefix, center, shaft_axis, chord_axis, width, height, blade_count,
          opposed=True, drive="bladePos", drive_blade=1, drive_shaft=None,
          parent=None, explode=None, sign0=1, frame=None):
    """Build `<prefix>_damper` (assembly empty), `<prefix>_frame` and
    `<prefix>_blade_NN`.

    width  -- opening extent along the shaft axis
    height -- opening extent along the chord axis
    drive_blade -- 1-based index (counted along +chord) of the drive blade
    drive_shaft -- distance from the damper center along -shaft_axis (the
                   front) to which the drive blade's shaft is extended
    """
    f = dict(FRAME, **(frame or {}))
    s = Vector(shaft_axis).normalized()
    c = Vector(chord_axis).normalized()
    n = s.cross(c)
    C = Vector(center)
    R = H.basis(s, c, n)          # damper-local (s, c, n) -> world rotation
    M = Matrix.Translation(C) @ R

    asm = H.assembly(scene, "%s_damper" % prefix, C, parent=parent, explode=explode)

    W2, H2, D2 = width / 2, height / 2, f["depth"] / 2
    tw, Lh, Lj = f["web"], f["head_lip"], f["jamb_lip"]
    pitch = (height - 2 * tw - 2 * f["clear"] - f["overlap"]) / blade_count
    chord = pitch + f["overlap"]
    half_len = W2 - tw - Lj - f["end_clear"]
    centers = [(k - (blade_count - 1) / 2) * pitch for k in range(blade_count)]

    # ---- frame: channel members (web + two return lips each) -----------------
    fb = H.MeshBuilder()
    for sc in (1, -1):  # head (+c) / sill (-c)
        fb.box((-W2, min(sc * H2, sc * (H2 - tw)), -D2), (W2, max(sc * H2, sc * (H2 - tw)), D2), "mat_frame", M)
        for sn in (1, -1):
            c0, c1 = sorted((sc * (H2 - tw), sc * (H2 - tw - Lh)))
            n0, n1 = sorted((sn * D2, sn * (D2 - tw)))
            fb.box((-W2 + tw, c0, n0), (W2 - tw, c1, n1), "mat_frame", M)
    for ss in (1, -1):  # jambs (+s / -s)
        s0, s1 = sorted((ss * W2, ss * (W2 - tw)))
        fb.box((s0, -H2 + tw, -D2), (s1, H2 - tw, D2), "mat_frame", M)
        for sn in (1, -1):
            s0, s1 = sorted((ss * (W2 - tw), ss * (W2 - tw - Lj)))
            n0, n1 = sorted((sn * D2, sn * (D2 - tw)))
            fb.box((s0, -H2 + tw + Lh, n0), (s1, H2 - tw - Lh, n1), "mat_frame", M)
        # jamb seal: closes the slot between the blade ends and the jamb web at the blade plane
        # (without it, air bypasses a closed damper around the blade ends)
        s0, s1 = sorted((ss * (half_len + 0.002), ss * (W2 - tw)))
        fb.box((s0, -H2 + tw, -0.012), (s1, H2 - tw, 0.012), "mat_frame", M)
        # flange bearings on the outside of each jamb
        for cc in centers:
            fb.cylinder((ss * W2, cc, 0), (ss * (W2 + 0.004), cc, 0), 0.016, 12, "mat_dark", M, bw=0.0)
    frame_obj = fb.to_object(scene, "%s_frame" % prefix, matrix=Matrix.Translation(C), parent=asm,
                             space="world", bevel=0.0015, segments=1)

    # ---- blades ---------------------------------------------------------------
    blades = []
    crimp = 1.0 if opposed else float(sign0)
    prof = _blade_profile(chord, crimp)
    # extrude frame: u -> local Y (chord), v -> local Z (normal), w -> local X (shaft)
    ext = H.basis((0, 1, 0), (0, 0, 1), (1, 0, 0))
    for k, cc in enumerate(centers):
        is_drive = (k + 1) == drive_blade
        bb = H.MeshBuilder()
        bb.extrude(prof, -half_len, half_len, "mat_blade", ext, bw=1.0)
        s_pos = W2 + SHAFT_POKE
        s_neg = -(drive_shaft if (is_drive and drive_shaft) else W2 + SHAFT_POKE)
        bb.cylinder((half_len - 0.02, 0, 0), (s_pos, 0, 0), SHAFT_R, 10, "mat_steel", bw=0.0)
        bb.cylinder((s_neg, 0, 0), (-half_len + 0.02, 0, 0), SHAFT_R, 10, "mat_steel", bw=0.0)
        world = Matrix.Translation(C + c * cc) @ R
        name = "%s_blade_%02d" % (prefix, k + 1)
        b = bb.to_object(scene, name, matrix=world, parent=asm, bevel=0.0009, segments=1)
        sign = (1 if k % 2 == 0 else -1) if opposed else 1
        sign *= sign0
        H.set_motion(b, "rotate", (0.0, 90.0 * sign), drive)
        blades.append(b)

    return dict(assembly=asm, frame=frame_obj, blades=blades, pitch=pitch, chord=chord,
                centers=[C + c * cc for cc in centers], shaft=s, chord_axis=c, normal=n,
                signs=[b["range"][1] / 90.0 for b in blades])


# ---------------------------------------------------------------------------
# Drive accessories
# ---------------------------------------------------------------------------

def crank(scene, name, shaft_point, shaft_axis, arm_dir, arm_len=0.1, drives=None,
          rng=(0.0, 90.0), parent=None):
    """Crank arm clamped on a shaft. Origin on the shaft axis, local X along the
    shaft, arm along local +Y. Adds `<name>_pin` empty at the arm tip."""
    M = H.shaft_basis(shaft_axis, arm_dir, shaft_point)
    mb = H.MeshBuilder()
    mb.cylinder((-0.008, 0, 0), (0.008, 0, 0), 0.02, 16, "mat_steel", bw=1.0)
    mb.box((-0.004, 0.0, -0.011), (0.004, arm_len, 0.011), "mat_steel", bw=0.8)
    mb.cylinder((-0.0048, arm_len, 0), (0.0048, arm_len, 0), 0.011, 12, "mat_steel", bw=0.8)
    mb.cylinder((-0.011, arm_len, 0), (0.011, arm_len, 0), 0.004, 8, "mat_dark", bw=0.0)
    # set screw on the hub
    mb.cylinder((0, 0, -0.019), (0, 0, -0.026), 0.004, 6, "mat_dark", bw=0.0)
    obj = mb.to_object(scene, name, matrix=M, parent=parent, bevel=0.0015, segments=1)
    H.set_motion(obj, "rotate", rng, drives)
    pin = H.empty(scene, name + "_pin", M @ Vector((0, arm_len, 0)), parent=obj, size=0.02)
    return obj, pin


def actuator(scene, name, shaft_point, front_face_y, back_face_y, body_len=0.22, height=0.13,
             tail=0.045, strap_to_y=None, parent=None):
    """Static direct-coupled actuator on a shaft along world Y, front face at
    `front_face_y` (more negative), body extending toward +X from the shaft."""
    sx, _, sz = shaft_point
    yc = (front_face_y + back_face_y) / 2
    origin = Vector((sx, yc, sz))
    mb = H.MeshBuilder()
    x0, x1 = sx - tail, sx - tail + body_len
    mb.box((x0, front_face_y, sz - height / 2), (x1, back_face_y, sz + height / 2), "mat_actuator", bw=1.0)
    # position scale ticks at 0 (12 o'clock) and 90 (3 o'clock) around the hub
    fy0, fy1 = front_face_y - 0.0012, front_face_y + 0.0005
    mb.box((sx - 0.0015, fy0, sz + 0.037), (sx + 0.0015, fy1, sz + 0.050), "mat_accent", bw=0.1)
    mb.box((sx + 0.037, fy0, sz - 0.0015), (sx + 0.050, fy1, sz + 0.0015), "mat_accent", bw=0.1)
    # label plate + manual override button
    mb.box((sx + 0.075, fy0, sz + 0.012), (sx + 0.155, fy1, sz + 0.040), "mat_accent", bw=0.1)
    mb.cylinder((sx + 0.135, front_face_y + 0.001, sz - 0.03), (sx + 0.135, front_face_y - 0.004, sz - 0.03),
                0.009, 12, "mat_dark", bw=0.3)
    # cable gland on the far end
    mb.cylinder((x1 - 0.001, yc, sz - 0.03), (x1 + 0.014, yc, sz - 0.03), 0.009, 10, "mat_dark", bw=0.0)
    # anti-rotation strap back to the damper frame
    if strap_to_y is not None:
        ax0, ax1 = sx + 0.028, sx + 0.048
        mb.box((ax0, back_face_y - 0.002, sz - 0.058), (ax1, strap_to_y - 0.004, sz - 0.054), "mat_steel", bw=0.3)
        mb.box((ax0 - 0.004, strap_to_y - 0.0042, sz - 0.075), (ax1 + 0.004, strap_to_y - 0.0005, sz - 0.035),
               "mat_steel", bw=0.3)
    obj = mb.to_object(scene, name, matrix=Matrix.Translation(origin), parent=parent, space="world", bevel=0.012,
                       segments=3)
    return obj


def actuator_hub(scene, name, shaft_point_front, shaft_axis=(0, 1, 0), drives=None, rng=(0.0, 90.0),
                 radius=0.028, thickness=0.013, parent=None):
    """Rotating shaft clamp / position disc on the actuator front face.
    Origin on the shaft (disc center), local X along the shaft, pointer at
    local +Y (world +Z at rest)."""
    x = Vector(shaft_axis).normalized()
    p = Vector(shaft_point_front) + x * (-thickness / 2)   # disc center
    M = H.shaft_basis(x, (0, 0, 1), p)
    t2 = thickness / 2
    mb = H.MeshBuilder()
    mb.cylinder((-t2, 0, 0), (t2, 0, 0), radius, 28, "mat_dark", bw=0.25)
    mb.cylinder((-t2 - 0.005, 0, 0), (-t2 + 0.001, 0, 0), 0.009, 12, "mat_steel", bw=0.5)
    mb.box((-t2 - 0.0016, 0.011, -0.0022), (-t2 + 0.0004, radius - 0.003, 0.0022), "mat_accent", bw=0.1)
    obj = mb.to_object(scene, name, matrix=M, parent=parent, bevel=0.002)
    H.set_motion(obj, "rotate", rng, drives)
    return obj


def link_rod(scene, name, pin_from, pin_to, pin_axis=(0, 1, 0), radius=0.005, parent=None):
    """Linkage rod: origin on `pin_from`, local +X aimed at `pin_to` (minimal
    rotation from +X), clevis ends straddling the crank arms."""
    a, b = H.world_matrix(pin_from).translation, H.world_matrix(pin_to).translation
    d = b - a
    L = d.length
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    M = Matrix.Translation(a) @ q.to_matrix().to_4x4()
    pa = (q.to_matrix().inverted() @ Vector(pin_axis)).normalized()
    cf = H.basis((1, 0, 0), pa, Vector((1, 0, 0)).cross(pa))   # clevis frame: X, pin, third
    mb = H.MeshBuilder()
    mb.cylinder((0.022, 0, 0), (L - 0.022, 0, 0), radius, 10, "mat_steel", bw=0.0)
    for end, sgn in ((0.0, 1), (L, -1)):
        # yoke block
        x0, x1 = sorted((end + sgn * 0.016, end + sgn * 0.030))
        mb.box((x0, -0.0105, -0.009), (x1, 0.0105, 0.009), "mat_steel", cf, bw=0.6)
        for side in (1, -1):
            y0, y1 = sorted((side * 0.0062, side * 0.0102))
            xa, xb = sorted((end - sgn * 0.012, end + sgn * 0.017))
            mb.box((xa, y0, -0.009), (xb, y1, 0.009), "mat_steel", cf, bw=0.6)
    obj = mb.to_object(scene, name, matrix=M, parent=parent, bevel=0.0012, segments=1)
    H.set_link(obj, pin_from.name, pin_to.name)
    return obj
