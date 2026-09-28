"""Build entry point.

Headless:   blender -b --factory-startup --python-exit-code 1 -P blender/build.py -- economizer
In Blender: import runpy; runpy.run_path("<repo>/blender/build.py", run_name="__main__")
            (module defaults to `economizer`; pass init_globals={"MODULE": "..."} to pick another)

Runs blender/modules/<name>.py into a freshly recreated scene named <name>,
self-checks it, exports build/<name>.raw.glb, saves build/<name>.blend (as a
copy; the open session keeps its own file path) and prints a summary.
"""
import os
import runpy
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUILD_DIR = os.path.join(ROOT, "build")


def _module_name():
    g = globals().get("MODULE")
    if g:
        return g
    argv = sys.argv
    rest = argv[argv.index("--") + 1:] if "--" in argv else []
    return rest[0] if rest else "economizer"


def _fresh_imports():
    for p in (os.path.join(HERE, "lib"), HERE):
        if p in sys.path:
            sys.path.remove(p)
        sys.path.insert(0, p)
    for k in list(sys.modules):
        if k == "hvaclab" or k == "parts" or k.startswith("parts."):
            del sys.modules[k]


def main():
    import bpy

    name = _module_name()
    t0 = time.time()
    _fresh_imports()
    import hvaclab as H

    mod_path = os.path.join(HERE, "modules", name + ".py")
    if not os.path.exists(mod_path):
        raise SystemExit("unknown module %r (%s)" % (name, mod_path))
    mod = runpy.run_path(mod_path, run_name="hvac_module_%s" % name)

    scene = H.reset_scene(name)
    H.activate_scene(scene)
    info = mod["build"](scene) or {}

    errors = H.self_check(scene, required=info.get("require", ()), drives=info.get("drives"))
    if errors:
        msg = "self-check failed:\n  " + "\n  ".join(errors)
        print(msg)
        raise RuntimeError(msg)

    os.makedirs(BUILD_DIR, exist_ok=True)
    glb = os.path.join(BUILD_DIR, "%s.raw.glb" % name)
    H.export_glb(scene, glb)
    blend = os.path.join(BUILD_DIR, "%s.blend" % name)
    for stale in (blend, blend + "1"):   # overwrite cleanly: no .blend1 backup artifacts
        if os.path.exists(stale):
            os.remove(stale)
    bpy.ops.wm.save_as_mainfile(filepath=blend, copy=True, check_existing=False)

    tris, per = H.tri_count(scene)
    objs = [o for o in scene.objects if o.type in {"MESH", "EMPTY"}]
    summary = {
        "module": name,
        "objects": len(objs),
        "meshes": sum(1 for o in objs if o.type == "MESH"),
        "empties": sum(1 for o in objs if o.type == "EMPTY"),
        "triangles": tris,
        "top_tris": sorted(per.items(), key=lambda kv: -kv[1])[:8],
        "raw_glb": glb,
        "raw_glb_bytes": os.path.getsize(glb),
        "blend": blend,
        "seconds": round(time.time() - t0, 2),
    }
    print("[hvac build] %(module)s: %(objects)d nodes (%(meshes)d meshes, %(empties)d empties), "
          "%(triangles)d tris, raw glb %(raw_glb_bytes)d bytes, %(seconds)ss" % summary)
    print("[hvac build] heaviest:", ", ".join("%s=%d" % kv for kv in summary["top_tris"]))
    return summary


if __name__ == "__main__":
    SUMMARY = main()
