# Asset conventions

The `.blend` and `.glb` files are build artifacts. The `bpy` generator scripts in `blender/` are the source of truth. Claude runs them through the Blender MCP, or you can run them headless with `blender -b -P blender/build.py -- <module>`.

## Axes

- Author in Blender's native Z-up space, meters. **Front = −Y**: the side the default web camera looks at, and the side that carries actuators, cranks, and the cutaway panel.
- The glTF exporter converts to Y-up (`x, y, z → x, z, −y`). A rotation about an object's local X survives unchanged.

## Node names

`<part>_<index>` in lower snake case, with a two-digit index when a part repeats:

```
oa_blade_03   ra_damper   oa_actuator_hub   flow_ma_04   anchor_mat
```

Regex (checked by the validator): `^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*(_\d{2})?$`

Airstream prefixes: `oa` outdoor air, `ra` return air, `ea` relief/exhaust air, `ma` mixed air, `sa` supply air.

## Pivots and motion

- Every moving object's origin sits on its pivot, and motion happens on the **local X axis**. For a damper blade, local X runs along the shaft. For a fan wheel, local X is the wheel axis.
- Assemblies (for example `oa_damper`) are empties with identity rotation. Parts are parented to them.

## Custom properties (exported as glTF `extras`)

| Property  | Type             | Meaning |
|-----------|------------------|---------|
| `motion`  | `rotate` \| `translate` \| `spin` \| `link` | How the runtime moves the part |
| `range`   | `[min, max]`     | `rotate`: degrees. `translate`: meters along local X. `spin`: `[0, deg/s at output = 1]` |
| `drives`  | string           | Name of the model output (normalized 0..1) that drives this part |
| `explode` | `[x, y, z]`      | Exploded-view offset in meters, **Blender world axes**. The runtime converts it to Y-up. It is applied relative to the parent. |
| `cutaway` | `true`           | Panel is ghosted when cutaway is on |
| `from`, `to` | string        | `motion: link` only. Names of two empties. The rod's origin sits on `from`, its local +X points at `to`, and the runtime re-aims it and stretches its X scale every frame. |
| `spread`  | `[across, normal]` | Flow empties only. Half-extents in meters for particle scatter. `across` is world depth (Blender Y). `normal` is perpendicular to the path within its plane. It is optional per empty and interpolated along the path. |

`rotate` maps output 0→`min` and 1→`max` linearly. Opposed-blade dampers alternate the sign of `range` from blade to blade. Parallel-blade dampers do not.

The `spin` and `link` motions and the `cutaway`, `from`/`to`, and `spread` properties extend spec v0.1. They exist because fans and linkage rods aren't ranged motions.

## Flow paths

Chains of empties named `flow_<stream>_<NN>`, starting at `00`. The runtime sorts by index, builds a Catmull-Rom curve, and spawns particles along it. A stream's particle density follows its model output, and its color follows its temperature.

Water streams (bindings with `medium: "water"`) run on pipe centerlines with a small spread (about `[0.02, 0.02]`). The runtime draws them on the pipe's near surface, so they stay visible through opaque insulation.

## Solved airflow (optional)

A module can ship a baked velocity field in place of, or on top of, its flow paths:

- `blender/sims/<module>_flow.py` poses the moving parts, calls the solver in `flowsolve.py`, and writes `public/lab/<module>/flow.json` and `flow.bin.gz`.
- The JSON gives the grid (`lo`, `h`, `n`, in Blender axes), the baked `states`, `emit` boxes where each stream's air enters (spanning the whole opening), and `stages`: planes `{ id, x }` where air takes on a new temperature, such as a mixing plane or each coil's fin pack. Older files may carry a single `mixPlaneX` instead.
- Layout is `staggered`. Each state has a `vmax` plus byte offsets to `ux`, `uy` and `uz`: face velocities, int8, x fastest, with −128 marking a wall face. `vmax` is the 99.5th-percentile face speed (at least 5.5 m/s); faster faces are clipped to it.
- Obstacle meshes must close every seam: frames and edge trims count, and damper jambs need seals. The bake's leak and streamline checks fail loudly when they don't.
- The runtime picks it up through `bindings.field`. The `flow_*` empties remain the fallback.
- `npm run assets:validate` also checks the field: sizes, offsets, positions, that emit boxes and stages lie inside the grid, that every y/z boundary face is a wall and every open x-boundary face carries flow, and that each state's openings balance within 1 %.

## Anchors

Empties named `anchor_<name>` mark where the UI pins HTML callouts, such as `anchor_mat` and `anchor_actuator`. Place them so callouts don't stack from the default camera. Put things that belong to the air inside the unit, and things that belong to devices just above the device.

## Condensate

A coil that sweats has three empties: `drip_a` and `drip_b` at the two ends of its bottom leaving edge, where drops form, and `drip_pan` on the water surface in the pan below. `bindings.condensate` wires them to a 0–1 rate.

## Materials

Materials are simple PBR with no image textures. The runtime looks some of them up by name, so keep these names:

| Material       | Base color | Notes |
|----------------|-----------|-------|
| `mat_housing`  | `#E9EAED` | Cool off-white, roughness 0.55 |
| `mat_frame`    | `#1E1F22` | Graphite, roughness 0.5 |
| `mat_blade`    | `#C4C7CA` | Brushed aluminum, metallic 0.6, roughness 0.35 |
| `mat_actuator` | `#FF5A1F` | Signal orange, roughness 0.45. The runtime pulses this amber on a fault. |
| `mat_dark`     | `#1C1D1F` | Fan wheel, hubs, rubber |
| `mat_steel`    | `#8C8F93` | Shafts, rods, fasteners. Metallic 0.8 |
| `mat_duct`     | `#D8D9DD` | Duct panels, metallic 0.15 |
| `mat_filter`   | `#F1F1F3` | Pleated media, roughness 0.9 |
| `mat_sensor`   | `#C8814F` | Copper averaging element |
| `mat_accent`   | `#F4F4F6` | Indicator marks and labels |
| `mat_liner`    | `#6B6E75` | Duct liner on interior faces. It's darker than the skin so a cutaway reads as "inside", but light enough to see into |
| `mat_fin`      | `#DADDE1` | Coil fin packs. Keep each fin pack its own object: the runtime tints it by water temperature while water flows |
| `mat_copper`   | `#C47A45` | Coil tubes, U-bends, headers, condensate trap |
| `mat_pipe`     | `#DADCE0` | Insulated pipe jacket. Pipe objects use only this material; the runtime tints them by water temperature |
| `mat_valve`    | `#B08D57` | Bronze valve bodies and fittings |
| `mat_cut`      | `#3A3C41` | Section-cut faces where the unit continues out of the diorama |
| `mat_deck`, `mat_insulation`, `mat_concrete`, `mat_wall` | | Site context: the roof-deck section and penthouse wall (`blender/parts/site.py`) |

## Budgets (per module)

These are enforced by `npm run assets:validate` after compression.

- 60k triangles
- 1.0 MB GLB, Meshopt compressed

## Pipeline

```
blender/build.py <module>      → build/<module>.blend, build/<module>.raw.glb
npm run assets:compress        → public/lab/<module>/scene.glb (Meshopt)
npm run assets:validate        → names, pivots, extras, flows, budgets
```
