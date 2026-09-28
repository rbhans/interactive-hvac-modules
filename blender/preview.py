"""Preview helpers (not part of the export): frame the 3D viewport on a
front-3/4 view and optionally render a PNG with a temporary camera + lights
that live only in the module's scene and are removed afterwards.

In Blender: runpy.run_path(".../blender/preview.py", init_globals={"ACTION": "view"})
            runpy.run_path(".../blender/preview.py", init_globals={"ACTION": "render", "OUT": "/path.png"})
"""
import math

import bpy
from mathutils import Euler, Quaternion, Vector

SCENE = globals().get("SCENE_NAME", "economizer")
TARGET = Vector(globals().get("TARGET", (0.62, 0.0, 0.98)))
YAW, PITCH = globals().get("YAW", -30.0), globals().get("PITCH", 24.0)   # degrees; front-left 3/4
DIST = globals().get("DIST", 7.6)
HIDE_CUTAWAY = globals().get("HIDE_CUTAWAY", True)   # show the interior like the runtime cutaway
POSE = globals().get("POSE", {})   # e.g. {"oaBladePos": 0.35} for a posed preview


def view_dir():
    yaw, pitch = math.radians(YAW), math.radians(PITCH)
    # camera sits at -Y (front), rotated toward -X by yaw, raised by pitch
    return Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))


def set_view(shading="MATERIAL"):
    scene = bpy.data.scenes[SCENE]
    win = bpy.context.window or bpy.context.window_manager.windows[0]
    win.scene = scene
    d = view_dir()
    rot = d.to_track_quat("Z", "Y")
    for area in win.screen.areas:
        if area.type != "VIEW_3D":
            continue
        sp = area.spaces.active
        r3d = sp.region_3d
        r3d.view_perspective = "PERSP"
        r3d.view_location = TARGET
        r3d.view_rotation = rot
        r3d.view_distance = DIST
        sp.lens = 50
        sp.shading.type = shading
        if shading == "SOLID":
            sp.shading.color_type = "MATERIAL"
            sp.shading.light = "STUDIO"
            sp.shading.show_cavity = True
        sp.overlay.show_extras = False
        sp.overlay.show_floor = False
        sp.overlay.show_axis_x = sp.overlay.show_axis_y = False
        sp.overlay.show_relationship_lines = False
    return True


def render(out, res=(1600, 1000), samples=32):
    scene = bpy.data.scenes[SCENE]
    made = []
    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scene.collection.objects.link(cam)
    made.append(cam)
    d = view_dir()
    cam.location = TARGET + d * DIST
    cam.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    for nm, rot, energy, size in (("preview_key", (math.radians(48), 0, math.radians(-38)), 2.2, 0.05),
                                  ("preview_fill", (math.radians(70), 0, math.radians(135)), 0.6, 0.3)):
        ld = bpy.data.lights.new(nm, "SUN")
        ld.energy = energy
        ld.angle = size
        lo = bpy.data.objects.new(nm, ld)
        lo.rotation_euler = rot
        scene.collection.objects.link(lo)
        made.append(lo)
    world = scene.world
    tmp_world = None
    if world is None:
        tmp_world = bpy.data.worlds.new("preview_world")
        tmp_world.color = (0.9, 0.9, 0.9)
        try:
            nt = tmp_world.node_tree
            bg = nt.nodes.get("Background")
            bg.inputs[0].default_value = (0.86, 0.87, 0.88, 1)
            bg.inputs[1].default_value = 0.65
        except Exception:
            pass
        scene.world = tmp_world
    prev_cam = scene.camera
    scene.camera = cam
    r = scene.render
    r.engine = "BLENDER_EEVEE"
    r.resolution_x, r.resolution_y = res
    r.resolution_percentage = 100
    r.film_transparent = False
    r.image_settings.file_format = "PNG"
    r.filepath = out
    try:
        scene.eevee.taa_render_samples = samples
    except Exception:
        pass
    scene.view_settings.exposure = -0.15
    scene.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Standard"
    # optional temporary pose: {drive: 0..1} applied to `rotate` parts, restored after
    posed = []
    for o in scene.objects:
        if o.get("motion") == "rotate" and o.get("drives") in POSE:
            lo, hi = o["range"]
            posed.append((o, o.rotation_euler.x))
            o.rotation_euler.x += math.radians(lo + (hi - lo) * POSE[o["drives"]])
    hidden = []
    if HIDE_CUTAWAY:
        for o in scene.objects:
            if o.get("cutaway") and not o.hide_render:
                o.hide_render = True
                hidden.append(o)
    try:
        with bpy.context.temp_override(scene=scene):
            bpy.ops.render.render(write_still=True, scene=scene.name)
    finally:
        for o in hidden:
            o.hide_render = False
        for o, x in posed:
            o.rotation_euler.x = x
    # clean up the temporary rig
    scene.camera = prev_cam
    for o in made:
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if isinstance(data, bpy.types.Camera):
            bpy.data.cameras.remove(data)
        elif isinstance(data, bpy.types.Light):
            bpy.data.lights.remove(data)
    if tmp_world is not None:
        scene.world = None
        bpy.data.worlds.remove(tmp_world)
    return out


ACTION = globals().get("ACTION", "view")
if ACTION == "view":
    RESULT = set_view(globals().get("SHADING", "MATERIAL"))
elif ACTION == "render":
    RESULT = render(globals()["OUT"])
