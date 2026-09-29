"""Lay-in square cone ceiling diffuser (4-way throw).

A square face frame that sits between the T-bar flanges, three nested square
louver cones and a center plaque below a pyramid back pan, with a round neck
on top. The louvers hang from two crossed bars under the pan. Everything is
mat_diffuser; air comes down the neck, fills the pan and leaves sideways
through the gaps between the cones.
"""
import math

from mathutils import Matrix

import hvaclab as H
from parts import ductwork as D

MAT = "mat_diffuser"
SEG = 24


def build(scene, name, cx, cy, face_z, half=0.288, neck_r_in=0.094, neck_r_out=0.1, neck_top=2.85,
          parent=None, explode=None):
    """face_z: bottom of the face frame (flush with the T-bar flanges);
    half: half-size of the face frame (the opening between the flanges)."""
    mb = H.MeshBuilder()
    at = Matrix.Translation((cx, cy, 0.0))
    frame_t = 0.012
    inner = half - 0.038
    zf1 = face_z + frame_t
    # face frame
    mb.plate((-half, half, -half, half), frame_t, MAT, Matrix.Translation((cx, cy, face_z + frame_t / 2)),
             hole=("rect", -inner, inner, -inner, inner), bw=0.6)
    # louver cones: thin sloped square bands, bottoms just above the ceiling plane
    zb, zt = face_z + 0.002, face_z + 0.037
    for dt, db in ((0.195, 0.225), (0.135, 0.165), (0.075, 0.105)):
        D.square_lathe(mb, [(db, zb), (db + 0.004, zb), (dt + 0.004, zt), (dt, zt)], MAT, at, bw=0.4)
    # center plaque, its hanger post and the two crossed bars the cones hang from
    mb.box((cx - 0.055, cy - 0.055, zb), (cx + 0.055, cy + 0.055, zb + 0.006), MAT, bw=0.6)
    zbar = zt - 0.002
    mb.box((cx - 0.006, cy - 0.006, zb + 0.006), (cx + 0.006, cy + 0.006, zbar), MAT, bw=0.3)
    c = math.sqrt(0.5)
    for k, (u, v) in enumerate((((c, c, 0), (-c, c, 0)), ((c, -c, 0), (c, c, 0)))):
        xf = at @ H.basis(u, v, (0, 0, 1))
        dz = -0.001 * k                     # crossing bars: never a shared face plane
        mb.box((-0.34, -0.004, zbar + dz), (0.34, 0.004, zbar + 0.006 + dz), MAT, xf, bw=0.3)
    # pyramid back pan on the frame, flat top with the neck hole
    pan_top = face_z + 0.105
    pan_half = 0.16
    D.square_lathe(mb, [(half - 0.012, zf1), (half - 0.008, zf1), (pan_half, pan_top), (pan_half - 0.004, pan_top)],
                   MAT, at, bw=0.6)
    mb.plate((-pan_half, pan_half, -pan_half, pan_half), 0.004, MAT, Matrix.Translation((cx, cy, pan_top + 0.002)),
             hole=("circle", 0.0, 0.0, neck_r_in, SEG), bw=0.6)
    # round neck (its bore lines up with the plate's hole)
    D.tube_wall(mb, pan_top + 0.004, neck_top, neck_r_in, neck_r_out, SEG, MAT, D.up_frame(cx, cy), bw=0.5)
    obj = mb.to_object(scene, name, matrix=Matrix.Translation((cx, cy, face_z)), parent=parent, space="world",
                       bevel=0.0015, segments=1)
    if explode is not None:
        H.set_explode(obj, explode)
    return obj
