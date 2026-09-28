"""Mantaflow helpers: turn a built module scene into a gas-flow bake and read the
resulting velocity and scalar grids back as numpy arrays.

The sim runs in its own scene, on evaluated copies of the module's geometry,
so the export scene is never touched."""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector


def reset_scene(name):
    old = bpy.data.scenes.get(name)
    if old:
        for o in list(old.collection.all_objects):
            data = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if data is not None and getattr(data, "users", 1) == 0 and isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
        bpy.data.scenes.remove(old)
    return bpy.data.scenes.new(name)


def baked_copy(scene, src, depsgraph, name=None):
    """World-space copy of `src` with modifiers applied, parent-free."""
    ev = src.evaluated_get(depsgraph)
    me = bpy.data.meshes.new_from_object(ev, depsgraph=depsgraph)
    ob = bpy.data.objects.new(name or ("sim_" + src.name), me)
    ob.matrix_world = src.matrix_world.copy()
    scene.collection.objects.link(ob)
    return ob


def box(scene, name, lo, hi):
    me = bpy.data.meshes.new(name)
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me.from_pydata(v, [], f)
    me.update()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def make_domain(scene, lo, hi, res, open_faces=(), cache_dir=None):
    dom = box(scene, "sim_domain", lo, hi)
    mod = dom.modifiers.new("Fluid", "FLUID")
    mod.fluid_type = "DOMAIN"
    d = mod.domain_settings
    d.domain_type = "GAS"
    d.resolution_max = res
    d.cache_type = "REPLAY"
    if cache_dir:
        d.cache_directory = cache_dir
    d.cache_frame_start = 1
    d.cache_frame_end = 250
    d.use_adaptive_timesteps = True
    d.vorticity = 0.0
    d.alpha = 0.0  # no buoyancy: air at one density
    d.beta = 0.0
    d.use_dissolve_smoke = False
    # keep every voxel in the cache: by default velocity is dropped wherever there's no smoke
    d.clipping = 0.0
    faces = {"front": "use_collision_border_front", "back": "use_collision_border_back",
             "left": "use_collision_border_left", "right": "use_collision_border_right",
             "top": "use_collision_border_top", "bottom": "use_collision_border_bottom"}
    for k, prop in faces.items():
        setattr(d, prop, k not in open_faces)
    dom.display_type = "WIRE"
    return dom


def make_obstacle(ob, planar=True, distance=0.0):
    mod = ob.modifiers.new("Fluid", "FLUID")
    mod.fluid_type = "EFFECTOR"
    e = mod.effector_settings
    e.effector_type = "COLLISION"
    e.use_plane_init = planar
    e.surface_distance = distance
    return ob


def make_inflow(scene, name, lo, hi, velocity, density=0.0):
    ob = box(scene, name, lo, hi)
    mod = ob.modifiers.new("Fluid", "FLUID")
    mod.fluid_type = "FLOW"
    f = mod.flow_settings
    f.flow_type = "SMOKE"
    f.flow_behavior = "INFLOW"
    f.flow_source = "MESH"
    f.use_initial_velocity = True
    f.velocity_coord = velocity
    f.velocity_factor = 0.0
    f.velocity_normal = 0.0
    f.density = density
    # emit from the whole volume of the box, not just a skin around it
    f.surface_distance = 1.0
    f.volume_density = 1.0
    f.use_plane_init = False
    f.subframes = 0
    ob.display_type = "WIRE"
    return ob


def read_vdb(path, res=None):
    """Velocity (nx, ny, nz, 3) and density (nx, ny, nz) from a Mantaflow OpenVDB cache frame.
    The grid size comes from the dense `shadow` grid unless given."""
    import openvdb

    grids, _ = openvdb.readAll(path)
    by = {g.name: g for g in grids}
    if res is None:
        _, (x1, y1, z1) = by["shadow"].evalActiveVoxelBoundingBox()
        res = (x1 + 1, y1 + 1, z1 + 1)
    nx, ny, nz = res
    vel = np.zeros((nx, ny, nz, 3), dtype=np.float32)
    den = np.zeros((nx, ny, nz), dtype=np.float32)

    def fill(grid, out):
        (x0, y0, z0), (x1, y1, z1) = grid.evalActiveVoxelBoundingBox()
        if x1 < x0:
            return
        shape = (x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1) + out.shape[3:]
        buf = np.zeros(shape, dtype=np.float32)
        grid.copyToArray(buf, ijk=(x0, y0, z0))
        out[x0:x1 + 1, y0:y1 + 1, z0:z1 + 1] = buf[: nx - x0, : ny - y0, : nz - z0]

    if "velocity" in by:
        fill(by["velocity"], vel)
    if "density" in by:
        fill(by["density"], den)
    return vel, den, res
