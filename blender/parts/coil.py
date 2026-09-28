"""Finned-tube water coil (hot water or chilled water) for an air-handler section.

World axes, air flows +X. Tubes run along Y (the coil length). Headers and the
connection stubs sit on the front (-Y) end, return bends on the back (+Y) end.
Rows are counted from the entering-air (upstream, -X) face. Circuiting is
counterflow: the supply header feeds the leaving-air row, the serpentine runs
row to row against the air, and the return header collects the entering-air row.
Back bends join rows (R, R-1), (R-2, R-3)...; front bends join (R-1, R-2)...

Objects, all parented to the `<prefix>_coil` assembly empty (identity rotation):
  <prefix>_coil_fins     aluminum fin pack, mat_fin ONLY (the runtime tints it)
  <prefix>_coil_casing   galvanized channels, tube sheets and blank-off plates
  <prefix>_coil_headers  headers, feeders, front bends, connection stubs + flanges
  <prefix>_coil_bends    tube stubs + U-bends on the back end
"""
import math

from mathutils import Matrix, Vector

import hvaclab as H

TS = 0.004          # tube-sheet thickness
STUB = 0.006        # straight tube stub out of a tube sheet before a bend
BW = 0.003          # blank-off plate thickness


def _bend(mb, xa, xb, z, y_in, y_out, r, steps=5, seg=6, mat="mat_copper"):
    """Hairpin between tubes at x = xa and x = xb (same z), leaving a tube sheet
    at y_in and bulging toward y_out's side."""
    sgn = 1.0 if y_out > y_in else -1.0
    ys = y_out
    c = (xa + xb) / 2
    rr = abs(xb - xa) / 2
    d = 1.0 if xb > xa else -1.0
    pts = [Vector((xa, y_in, z))]
    for k in range(steps + 1):
        ph = math.pi * (1 - k / steps)
        pts.append(Vector((c + d * rr * math.cos(ph), ys + sgn * rr * math.sin(ph), z)))
    pts.append(Vector((xb, y_in, z)))
    mb.tube(pts, r, seg, mat, bw=0.0)


def build(scene, prefix, x, depth, face_w, face_h, fin_z0, rows, tubes,
          fin_pitch=0.012, fin_t=0.002, fin_proud=0.006, fin_axis="z",
          tube_r=0.0055, header_r=0.02, conn_r=0.017, conn_z=(0.3, 1.2), conn_y=-0.655,
          channel=0.04, seal=None, bottom_seal=None, explode=None, parent=None):
    """Build `<prefix>_coil` and its parts.

    x, depth      -- coil center x and casing depth along the airflow
    face_w/h      -- finned face (Y width x Z height); fin_z0 = bottom of the face
    rows, tubes   -- tube rows (along X) and tubes per row (along Z)
    fin_pitch/t   -- fin spacing and plate thickness; fin_proud = how far the
                     plates stand out of the pack's recessed core on both faces
    fin_axis      -- "z": horizontal plates (horizontal fin lines on the face);
                     "y": vertical plates perpendicular to the tubes
    conn_z        -- (supply, return) connection heights; supply is low, return high
    conn_y        -- flange joint plane of the connection stubs (outside the front panel)
    seal          -- (y0, y1, z0, z1) section interior the casing fills out to;
                     without it the casing is `channel` deep above and below the fins
    bottom_seal   -- (y0, y1, z0): the bottom member fills this instead, e.g. down
                     into a drain pan (y0/y1 = pan inner walls, z0 = pan floor)
    """
    x0, x1 = x - depth / 2, x + depth / 2
    fw2 = face_w / 2
    fz0, fz1 = fin_z0, fin_z0 + face_h
    yts = fw2 + 0.001 + TS                         # outer face of the tube sheets
    if seal is None:
        seal = (-yts, yts, fz0 - 0.001 - channel, fz1 + 0.001 + channel)
    ztop = seal[3]
    zbot = bottom_seal[2] if bottom_seal is not None else seal[2]
    cz = (zbot + ztop) / 2
    asm = H.assembly(scene, "%s_coil" % prefix, (x, 0.0, cz), parent=parent, explode=explode)
    at = Matrix.Translation((x, 0.0, cz))

    # tube field (inline rows; row 1 = entering-air face)
    rx = [x0 + (i + 0.5) * depth / rows for i in range(rows)]
    tz = [fz0 + (k + 0.5) * face_h / tubes for k in range(tubes)]

    # ---- fin pack: thin plates through a recessed core (mat_fin only) ----------
    fb = H.MeshBuilder()
    fx0, fx1 = x0 + 0.001, x1 - 0.005
    if fin_axis == "z":
        n = int((face_h - fin_t) / fin_pitch) + 1
        p = (face_h - fin_t) / (n - 1)
        for k in range(n):
            z = fz0 + fin_t / 2 + k * p
            fb.box((fx0, -fw2, z - fin_t / 2), (fx1, fw2, z + fin_t / 2), "mat_fin", bw=0.0)
        fb.box((fx0 + fin_proud, -fw2 + 0.001, fz0 + fin_t / 2), (fx1 - fin_proud, fw2 - 0.001, fz1 - fin_t / 2),
               "mat_fin", bw=0.0)
    else:
        n = int((face_w - fin_t) / fin_pitch) + 1
        p = (face_w - fin_t) / (n - 1)
        for k in range(n):
            y = -fw2 + fin_t / 2 + k * p
            fb.box((fx0, y - fin_t / 2, fz0), (fx1, y + fin_t / 2, fz1), "mat_fin", bw=0.0)
        fb.box((fx0 + fin_proud, -fw2 + fin_t / 2, fz0 + 0.001), (fx1 - fin_proud, fw2 - fin_t / 2, fz1 - 0.001),
               "mat_fin", bw=0.0)
    fins = fb.to_object(scene, "%s_coil_fins" % prefix, matrix=at, parent=asm, space="world")

    # ---- casing: a blank-off frame around the fin pack --------------------------
    # Top and bottom members are solid across the full depth and fill out to the
    # section (roof / floor, or the drain-pan floor via `bottom_seal`), so no air
    # slips over or under the fins. At the sides, the tube sheets plus a plate on
    # the entering face and one on the leaving face close off the pockets that
    # hold the headers and bends (they stay visible).
    cb = H.MeshBuilder()
    m = "mat_steel"
    xe = x1 - BW - 0.001        # tube sheets end where the leaving-face plate begins
    sy0, sy1, sz0, sz1 = seal
    cb.box((x0, sy0, fz1 + 0.001), (x1, sy1, sz1), m, bw=1.0)                          # top member
    if bottom_seal is not None:
        by0, by1, bz0 = bottom_seal
        cb.box((x0, by0, bz0), (x1, by1, fz0 - 0.001), m, bw=1.0)                      # bottom member (in the pan)
    else:
        cb.box((x0, sy0, sz0), (x1, sy1, fz0 - 0.001), m, bw=1.0)                      # bottom member
    for s in (1, -1):
        ya, yb = sorted((s * (fw2 + 0.001), s * yts))
        cb.box((x0, ya, fz0 - 0.001), (xe, yb, fz1 + 0.001), m)                        # tube sheets
        ya, yb = sorted((s * yts, s * (sy1 if s > 0 else -sy0)))
        cb.box((x0, ya, fz0 - 0.001), (x0 + BW, yb, fz1 + 0.001), m, bw=0.6)           # entering-face side plate
        ya, yb = sorted((s * fw2, s * (sy1 if s > 0 else -sy0)))
        cb.box((x1 - BW, ya, fz0 - 0.001), (x1, yb, fz1 + 0.001), m, bw=0.6)           # leaving-face side plate
    casing = cb.to_object(scene, "%s_coil_casing" % prefix, matrix=at, parent=asm, space="world",
                          bevel=0.0015, segments=1)

    # ---- back end: tube stubs + U-bends joining rows (R, R-1), (R-2, R-3)... -------
    bb = H.MeshBuilder()
    rs = abs(rx[1] - rx[0]) / 2 if rows > 1 else 0.02
    pairs_back = [(i, i - 1) for i in range(rows - 1, 0, -2)]
    pairs_front = [(i, i - 1) for i in range(rows - 2, 0, -2)]
    for a, b in pairs_back:
        for z in tz:
            _bend(bb, rx[a], rx[b], z, yts - 0.001, yts + STUB, tube_r)
    bends = bb.to_object(scene, "%s_coil_bends" % prefix, matrix=Matrix.Translation((x, yts + STUB + rs, cz)),
                         parent=asm, space="world")

    # ---- front end: headers, feeders, front bends, connection stubs ---------------
    hb = H.MeshBuilder()
    hy = -(yts + 0.012 + header_r)
    # headers sit in the side pocket, clear of the entering/leaving side plates
    hx_s = min(rx[-1], x1 - BW - 0.003 - header_r)     # supply header: leaving-air row
    hx_r = max(rx[0], x0 + BW + 0.003 + header_r)      # return header: entering-air row
    hz0, hz1 = tz[0] - 0.025, tz[-1] + 0.025
    for hx in (hx_s, hx_r):
        hb.cylinder((hx, hy, hz0), (hx, hy, hz1), header_r, 16, "mat_copper", bw=1.0)
        # vent / drain plugs (kept short of the casing's top and bottom members)
        hb.cylinder((hx, hy, hz1 - 0.001), (hx, hy, min(hz1 + 0.006, fz1 - 0.001)), 0.007, 6, "mat_valve", bw=0.3)
        hb.cylinder((hx, hy, hz0 + 0.001), (hx, hy, max(hz0 - 0.006, fz0 + 0.001)), 0.007, 6, "mat_valve", bw=0.3)
    for row, hx in ((rows - 1, hx_s), (0, hx_r)):
        for z in tz:
            hb.cylinder((rx[row], -(yts - 0.001), z), (rx[row], hy, z), tube_r, 6, "mat_copper", bw=0.0)
    for a, b in pairs_front:
        for z in tz:
            _bend(hb, rx[a], rx[b], z, -(yts - 0.001), -(yts + STUB), tube_r)
    conns = []
    for hx, z in ((hx_s, conn_z[0]), (hx_r, conn_z[1])):
        hb.cylinder((hx, hy, z), (hx, conn_y + 0.004, z), conn_r, 16, "mat_steel", bw=0.0)
        hb.cylinder((hx, conn_y + 0.013, z), (hx, conn_y + 0.001, z), conn_r + 0.022, 20, "mat_steel", bw=1.0)
        # reinforcing boss where the stub leaves the header
        hb.cylinder((hx, hy - header_r + 0.004, z), (hx, hy - header_r - 0.012, z), conn_r + 0.004, 16,
                    "mat_copper", bw=0.5)
        conns.append(Vector((hx, conn_y, z)))
    headers = hb.to_object(scene, "%s_coil_headers" % prefix, matrix=Matrix.Translation((x, hy, cz)), parent=asm,
                           space="world", bevel=0.002, segments=1)

    return dict(assembly=asm, fins=fins, casing=casing, headers=headers, bends=bends,
                supply_conn=conns[0], return_conn=conns[1], entering_x=x0, leaving_x=x1,
                face=(fx0, fx1, -fw2, fw2, fz0, fz1), rows_x=rx, tubes_z=tz, fin_count=n)
