# BAS Lab

Small interactive modules. Each one pairs a 3D equipment scene with BAS-style controls and teaches one idea:

- **01 Economizer:** *damper position isn't outdoor-air percentage.*
- **02 Coils & valves:** *half the water does most of the work.*
- **03 VAV box:** *pressure-independent doesn't mean pressure-proof.*
- **04 Static pressure reset:** *trim & respond, one request at a time.*

Built on Next.js 15, React 19, TypeScript, Tailwind v4, React Three Fiber, and drei. `components.json` is present, so shadcn components drop in if you need them.

```bash
npm install
npm run dev          # http://localhost:3000/lab/economizer
npm test             # model unit tests
```

Routes:

- `/` lists the modules.
- `/lab/[slug]` shows a full module. Add `?preset=stuck` to start from a preset.
- `/lessons/economizer` is an MDX lesson that embeds the module twice with `<LabEmbed />`.

Live at [robboborben.xyz/tools/bas-lab](https://robboborben.xyz/tools/bas-lab/) (see [Deploy](#deploy)).

## Deploy

BAS Lab ships as a static export on its own Cloudflare Worker, `bas-lab`. It has no public URL of its own: the personal site's Worker (`../personal-site`) forwards `robboborben.xyz/tools/bas-lab/*` to it through its `BAS_LAB` service binding, so a BAS Lab update never needs a site deploy.

```bash
npm run deploy         # lint + tests, static export, lay out dist/site, wrangler deploy
npm run site:preview   # after site:build + site:bundle: the Worker locally at :8787/tools/bas-lab/
```

- `npm run site:build` exports with `BASE_PATH=/tools/bas-lab` and `SITE_HOME=/tools`. The base path goes on every route; `asset()` (`src/lib/basePath.ts`) adds it to fetched files like GLBs and airflow fields; `SITE_HOME` adds the same "← Tools" bar across the top that the site's live demos (Dial, BAS System Map) wear (`src/app/SiteBar.tsx`). Plain `npm run dev` and `npm run build` stay at the root with no back link.
- The export uses trailing slashes (`/lab/economizer/`), so every request stays under the base path.
- `npm run site:bundle` copies the export to `dist/site/tools/bas-lab/`, the path the Worker serves it at. It fails if a page, a GLB or a field is missing, or if the build lacks the base path.
- `deploy/worker.ts` redirects `/` and `/tools/bas-lab` to `/tools/bas-lab/`. Everything else is a static asset; missing pages get the export's 404.

Deploy this Worker before the first site deploy that includes the binding.

## Layout

```
src/
  lab/                     the shell, built once
    types.ts               module contract
    registry.ts            slug → lazy module + GLB
    heat.ts                one °F → color ramp for every module (OKLab-interpolated)
    shell/                 runtime store, sim loop, page layout, presets, explainer card, shortcuts, embeds
    scene/                 R3F canvas, GLB indexer, part bindings, flow particles, callouts
    controls/              BAS controls kit: fader, setpoint, knob, override + priority array,
                           point readout, trend, fault drawer
  modules/economizer/      one module
    model.ts               pure simulation (init / step / outputs), no rendering
    model.test.ts
    bindings.ts            outputs → part motion, flows, highlights, callouts
    controls.ts            which controls appear, and their ranges
    presets.ts             named starting states, including the break-it ones
    card.mdx               explainer copy
    CurvePlot.tsx          module-specific instrument (installed characteristic)
  modules/coils/           module 02, same files; CoilCurve.tsx is its instrument (coil + valve curves)
blender/                   bpy generators, the source of truth for 3D
scripts/                   asset build, compress, validate
docs/asset-conventions.md  names, pivots, extras, flow paths, budgets
```

## How a module runs

1. `ModuleHost` lazy-loads the module and creates its own zustand store. Embeds get separate stores, so two copies on one page don't interfere.
2. `useSimLoop` steps `model.step` on a 50 ms timer in fixed 0.05 s sub-steps at 1×, 4×, or 16× speed. The timer is independent of rendering, so readouts and trends keep updating while the 3D view is scrolled off screen. It pauses when the tab is hidden.
3. The canvas runs `frameloop="demand"`. It asks for continuous frames only while it's on screen, the tab is visible, and the sim is running or a view transition is playing.
4. `Equipment` reads the GLB extras (`motion`, `range`, `drives`, `explode`, `cutaway`, `from`/`to`) and animates everything generically. The module code never touches three.js.

Command, feedback, and physical reality are kept apart all the way through:

- The model keeps `cmd`, `actuatorPos`, and `bladePos` as separate state.
- The points list splits **BAS reads** from **Reality · the BAS can't see this**.
- The curve plot draws where the BAS *thinks* the blades are (ring) against where they are (dot).

## Economizer model: what's real and what's simplified

What the model does:

- **Damper curves:** each damper follows a power-law inherent curve, with exponent 2.5 for opposed blades and 1.75 for parallel. The installed curve is φ = 1/√(N/f² + 1 − N). The exponents are calibrated so the installed curve is near-linear at the ASHRAE rule-of-thumb ratios: a system-to-damper resistance ratio of about 10 for opposed blades and about 2.5 for parallel. Checked against Johnson Controls' *Damper Application Engineering* report (FAN 268.1): the inherent curves (its Fig. 1) and the linked OA/RA curves at 7 % authority (its Fig. 9) agree within a few points, and its recommended mixing-damper authorities are 8–10 % opposed and 20–25 % parallel. Lower authority bends each damper toward quick-opening (its Fig. 10), which the Authority slider shows.
- **Mixing:** the OA and return dampers are linked, with the return damper at 1 − x, and draw from a common mixed-air plenum. The OA fraction is `φ_oa(x) / (φ_oa(x) + b·φ_ra(1 − x))`, where `b` is the return-path balance. Balanced paths cross 50/50 at mid-stroke, and the position/percentage gap is largest near minimum OA.
- **Mixed-air temperature:** MAT is an energy balance, `f·OAT + (1 − f)·RAT`, passed through a transport lag and an averaging-sensor lag.
- **Control:** the MAT loop is a direct-acting PI with a clamped integral (anti-windup), bounded by minimum OA. A fixed dry-bulb high limit with 2 °F hysteresis locks the economizer out. The BACnet priority array is modeled as follows:
  - Freeze protection at priority 5: below 40 °F it holds minimum OA, below 35 °F it closes the damper, and it releases after 20 s above 45 °F. While it (or the high-limit lockout) holds the damper, the loop tracks minimum OA, so on release it picks up from there instead of throwing the damper open and tripping again.
  - The operator at priority 8.
  - The program at priority 16.
- **Relief:** relief airflow follows from mass balance: outdoor air minus about 6 % lost to exhaust and exfiltration.

Where it simplifies:

- Time runs about 7.5× faster than real. The actuator, lags and integral time are all scaled together.
- Air density is equal on both paths. At 0 °F the true mass fraction would read a few percent higher.
- The fan holds the mixed-plenum suction constant, so total airflow changes aren't fed back into the mix.
- There are no coils downstream, and no mixing-box stratification.
- Freeze protection acts on mixed air, where ASHRAE Guideline 36 uses supply air (40 °F and 38 °F stages). It has no multi-minute timers, and there's no hardwired freezestat or fan shutdown.

## Coils model: what's real and what's simplified

What the model does:

- **Coil heat transfer:** each coil is ε-NTU counterflow (multi-row coils are close to it). UA combines an air-side film that scales with airflow^0.7 and a water-side film that scales with water flow^0.8, with the air side about 70 % of the resistance. The coils are sized to textbook design points:
  - Cooling: 78 °F air and 44 °F water give 55 °F air and a 12 °F water rise.
  - Heating: 50 °F air and 180 °F water give 90 °F air and a 20 °F water drop.
- **The coil curve:** heat moved against water flow falls out of the ε-NTU math rather than being drawn in. At design conditions, 50 % water gives about 80 % of full capacity on either coil, and 10 % gives about 34 % of the heating or 26 % of the cooling.
- **Valves:** the inherent characteristic is modified equal-percentage with rangeability 30, reaching 0 when shut, or linear. The installed curve uses the same authority formula as the dampers, φ = 1/√(N/f² + 1 − N). A right-sized valve has N = 0.5 and passes 1.05× design flow wide open. An oversized one has N = 0.12 and passes 1.35×.
- **Stem:** 1.5 % backlash between actuator and stem. It's harmless on a right-sized valve and makes an oversized linear valve hunt near shutoff. A valve driven to either end of its stroke seats fully shut or opens fully. Leak-by sets a floor on flow, and a stuck stem holds its position while the actuator keeps moving and reporting. The stuck stem belongs to the valve that was active when it stuck, and stays stuck through a mode change.
- **Air path:** air passes the heating coil and then the cooling coil in series. Each coil's leaving air lags its steady-state value through a coil-mass time constant, and the discharge sensor adds its own lag and an optional offset.
- **Control:** one discharge-air PI loop with a clamped integral (anti-windup) drives whichever valve the mode selects, and the other valve is driven shut. Switching modes restarts the new valve from shut. An operator override writes at priority 8 over the program at 16.
- **Condensate:** it drips when the estimated fin surface temperature is below the entering dew point (Magnus formula). The surface temperature sits between the water and air temperatures in proportion to the film resistances.

Where it simplifies:

- Time runs about 7× faster than real, like the economizer.
- The cooling coil is sensible-only. Latent load (moisture removal) doesn't change the leaving air temperature or the water ΔT, so on a humid day a real coil would take more water for the same discharge temperature. The presets whose cues quote cooling numbers (**Warm afternoon**, **Wide open**) run 40 % RH air, so the coil stays dry and those numbers hold.
- The plant holds supply water temperature and differential pressure constant. Valve flow doesn't interact between the two coils or with other loads.
- There's no freeze protection on the heating coil and no low-limit or mixed-air interaction with the economizer upstream.
- Only water coils are modeled. The `COILS` table is where DX, gas and electric heat would go.

## VAV box model: what's real and what's simplified

What the model does:

- **The box:** a 10" single-duct, cooling-only box. Airflow is set by inlet static pressure pushing through the butterfly damper and the discharge side: `Q = 1000·√(P / (0.1/f(x)² + 0.25))` cfm, with the damper and casing at 0.1 in. and the discharge, flex and diffusers at 0.25 in. (both at the 1000 cfm design flow). Wide open it needs about 0.35 in. to make full flow. The damper's inherent curve is a power law (exponent 2.5, 2 % leakage), like a single blade.
- **Flow sensor:** an amplifying flow cross (gain 2.3) on the 10" inlet reads about 0.48 in. at 1000 cfm and 0.011 in. at 150 cfm. Airflow = K·√ΔP with K ≈ 1440. The transducer has a little deterministic noise (±0.001 in.); the faults add a zero drift or a gain error.
- **Control:** a room PI loop (8 °F proportional band) sets an airflow setpoint between the minimum and the maximum, and an airflow PI loop drives a floating actuator. The actuator has a small deadband and overdrives to the stops at 0 and 100 %. Pressure-dependent mode skips the airflow loop: the room loop sets the damper position directly. Operator override writes the damper at priority 8.
- **Room:** one lumped air-and-furniture mass with a heat gain and a thermostat lag. The supply air temperature is an input.
- **Duct pressure swings:** a slow sine (40 s) around the set static, standing in for the other boxes on the duct opening and closing.
- **Starved flag:** the actuator ≥ 95 % open and the measured airflow under 92 % of setpoint for 3 s. That's the kind of condition a trim-and-respond static-pressure reset counts as a request.

Where it simplifies:

- Time runs about 7× faster than real, like the other modules.
- Cooling only: no reheat coil, so a cool room with little heat sits at minimum airflow and runs cold.
- The duct pressure at the box doesn't respond to this box's own airflow (a real duct would sag a little as this box opens).
- No sound model. "A real box would whistle" in the Too much static preset is the only mention.
- The room air and the supply main are drawn with path streams; only the branch, box, discharge and drops are a solved field.

## Static pressure reset model: what's real and what's simplified

What the model does:

- **The system:** one supply fan on a VFD feeding a supply main with four pressure-independent VAV boxes (700–1000 cfm design), each serving a zone. The network is solved every step: march the pressures and airflows up the main from the last takeoff, and bisect for where the fan curve at this speed (shutoff 4.5 in., 3.3 in. at 3500 cfm at full speed, affinity-scaled) meets the system. The air handler's filters and coil take 1 in. at design airflow; the main loses a few hundredths between takeoffs. Each box is the VAV module's box with its own design airflow and downstream resistance; the corner office has the longest run.
- **Fan loop:** a PI loop sets the drive's speed to hold the static sensor (between the second and third takeoffs) at the setpoint, with a speed ramp and a 15 % minimum. Operator override writes the speed at priority 8. Fan power is airflow × fan static ÷ (6356 × 0.55).
- **Trim & respond:** ASHRAE Guideline 36's static pressure reset, with its example parameters: trim 0.05 in., respond 0.06 in. per request over the ignored ones, at most 0.13 in. a step, between 0.1 in. and the maximum (the fixed setpoint). Requests follow Guideline 36's VAV sequence: 1 while the damper is over 95 % open (held until it's under 85 %), 2 when it's also under 70 % of its airflow setpoint for a minute, 3 under 50 %. Each zone's requests are multiplied by its importance multiplier (1, or 0 to ignore it).
- **Request-hours:** a running share of recent time each box spent asking, standing in for Guideline 36's request-hours accumulators. The rogue flag is this module's own rule: a counted zone starved (2–3 requests) most of the time while the setpoint sits at its maximum.
- **Zones:** the VAV module's room loop, airflow loop and floating actuator per box, with a little heat from the walls and neighbors (200 Btu/h·°F toward 76 °F) so a starved room settles warm instead of running away.
- **"Fixed setpoint" comparison:** the fan power the same airflows would take with the sensor held at the maximum. Pressure-independent boxes hold their airflows either way, so the difference is all pressure.

Where it simplifies:

- Time is compressed: Guideline 36 steps every 2 minutes and wants a condition held for a minute; here those are 10 s and 5 s. The boxes' actuators stroke in 13 s, like the VAV module's.
- Fan efficiency is constant. Real fan and drive efficiency falls at low speed, so the savings at low static are a little optimistic.
- No startup sequence (Guideline 36 starts at 0.5 in. and holds it for a delay before trimming), no suppression of requests right after a zone setpoint change, and no request-hours alarm thresholds.
- Air is drawn with path streams throughout (no solved field), so there's no "Be the air" ride on this one.

Checked against: the trim & respond defaults in LBNL's reference Guideline 36 implementation ([SupplyFan.mo](https://github.com/lbl-srg/modelica-buildings/blob/master/Buildings/Controls/OBC/ASHRAE/G36/AHUs/MultiZone/VAV/SetPoints/SupplyFan.mo): 120 Pa start, 25 Pa minimum, 120 s, 2 ignored, −12 / +15 / 32 Pa), its VAV request rules ([SystemRequests.mo](https://github.com/lbl-srg/modelica-buildings/blob/master/Buildings/Controls/OBC/ASHRAE/G36/TerminalUnits/Reheat/Subsequences/SystemRequests.mo)), and Trane's [Guideline 36 Engineers Newsletter](https://www.tranehk.com/files/News/EngrNewsletter/Trane%20Engineers%20Newsletter_May2021.pdf) for the importance multiplier, the running request totals and rogue zones holding the setpoint at its maximum. The fan, duct and box numbers are typical values, not one real system's.

## Airflow

The air in the 3D view follows a velocity field solved on the unit's real geometry, not hand-drawn paths.

- **Solver** (`blender/sims/flowsolve.py`): incompressible, inviscid (potential) flow on a 5 cm grid.
  - **Cut faces:** a face between two cells is a wall only where a ray between their centers hits a mesh. The 12 mm damper blades block exactly where they are, and the gaps between them stay open.
  - **Openings:** each gets the flow rate the economizer model predicts at that damper position (outside air in, return air in, supply out, relief out). The solve conserves mass exactly, and the bake refuses to write a field whose openings don't balance or whose solve didn't converge. Where a nearly-closed damper seals an opening off at 5 cm resolution (the return damper at 75 % and 100 % OA), the model's flow is carried across that damper's blade plane, one way only.
  - **Airspace:** only the unit, its two ducts and the zone in front of the dampers carry air. The rest of the box is closed off before solving.
- **Stored data** (`blender/sims/economizer_flow.py`): five damper positions baked into `public/lab/economizer/flow.{json,bin.gz}`, about 215 KB.
  - Velocities are stored on cell faces (a staggered grid), the solver's native quantity, as signed-square-root int8. Each state's scale is the 99.5th percentile of speed (at least 5.5 m/s). The few faster faces, in the fan-inlet jet, are clipped, which the browser's on-screen speed cap hides anyway. The stored field conserves mass to within about 2 % of supply.
  - Wall faces are marked separately.
- **Browser** (`src/lab/scene/AirFlow.tsx`):
  - Particles read only the faces of the cell they're in, so they never pick up velocity from the far side of a wall.
  - They collide with wall faces, one axis and one face at a time, so turbulence or a long frame can't push them through a panel or cut a corner. The RK2 midpoint collides too, so it never samples air from the far side of a wall.
  - They blend the two nearest baked positions by the physical blade angle, with the nearest position's walls closed in both, carry their source temperature, and blend to each stage's temperature (mixed air, then each coil) when they actually cross it going downstream. Return air enters past the mixing plane, so it keeps its own temperature until it comes around through the return damper.
  - A particle that stops getting anywhere (judged by how far it actually moves) fades out, so none hang pinned against a blade.
  - With reduced motion the particles hold still, and the still picture is rebuilt whenever the damper position or the airflow split changes.
  - They're drawn in two layers: a faint haze of soft puffs tinted by temperature, so the air reads as a mass of gas, and long thin wisps through each particle's recent path, faint at both ends. There's deliberately no bright head or tapering tail; comet-style particles read as swimming blobs, not air.
- **Checks the bake enforces:**
  - **Shell leaks:** air crossing the unit's roof or end wall anywhere but the damper and supply openings. The bake fails above 1% of supply.
  - **Where the air goes:** 400 seeds per inlet are traced with the same wall-aware stepping the browser uses. The bake fails if less than 98% of outside air reaches the supply, traced for up to 400 s of air travel, so a slow detour can't hide as "stuck". It warns if the traced return-air split drifts more than 6 points from the model.
  - Current result: outside air reaches the supply at 99.8–100% at every position with none escaping to the relief, and the return-air split is within 1–2.5 points of the model.
- **Geometry the checks forced:**
  - The unit's edge frame counts as an obstacle. Without it every panel seam was a slot.
  - Dampers have jamb seals. Without them, a closed damper leaked around its blade ends.
  - The solve domain is sealed to the unit, its ducts and the intake/relief zone. Without that, air looped around the outside of the unit (under the floor, past the duct stubs) between the relief and the intake: at 75 % about 12 % of the relief air came back in.

**Coils** (`blender/sims/coils_flow.py`): one state on a 4 cm grid, since nothing in the coil section changes the air's path. Air enters over the whole section cut and leaves through the supply duct. Fin packs and filter media are porous; casings, headers and the drain pan are solid. The bake fails if less than 97% of the air passes through either fin pack. That check forced solid blank-off frames around both coils, including a seal between the cooling coil and its drain pan. Current result: 100% through both coils and 100% of traced air reaching the supply. Each coil is a temperature stage: air takes on that coil's leaving temperature as it crosses the middle of the fin pack.

Water streams run along the pipe centerlines. Because the insulated pipes are opaque, the browser slides each water streak along the view ray to the pipe's near surface. That changes only depth, so streaks stay inside the pipe's outline.

**Be the air** (`src/lab/scene/ride.ts`, `RideCamera.tsx`, `shell/Ride.tsx`): a first-person trip through the unit, started with the display's "Be the air" key or `A`.
- A trip is one real path: a seed in an inlet, carried through the solved field with the particles' wall-aware stepping (no turbulence), resampled every 4 cm and lightly smoothed.
- Where you end up is drawn honestly from anywhere across the inlet, so economizer return air leaves by the relief damper as often as the model says (within sampling noise at every baked position). The camera then rides a path nearer the middle of the inlet with the same fate.
- The camera moves at about a third of real air speed (faster at 4× and 16×) and looks a little way ahead.
- A readout names each stretch, from the module's `bindings.ride` zones: boxes in Blender coordinates, with notes built from live outputs. It also shows your temperature, which follows the same stage planes as the particles, plus your speed and progress.
- The trip ends on a card for the exit box it left through.
- Riding hides labels and the cutaway, and everything comes back on leave (Esc). It's off with reduced motion and in compact embeds.

Why not Mantaflow (Blender's gas solver)? It's built for smoke plumes and won't hold a prescribed airflow through a duct network. Its inflows are tied to smoke emission, and its cache drops velocity wherever there's no smoke.

```bash
npm run assets:flow            # headless: re-bake the economizer fields (≈5 s), with the checks above
npm run assets:flow -- coils   # the coil section
```

## Asset pipeline

```bash
npm run assets:build      # headless Blender: blender/build.py economizer → build/economizer.{blend,raw.glb}
npm run assets:compress   # → public/lab/economizer/scene.glb (Meshopt)
npm run assets:validate   # names, pivots, extras, flow chains, anchors, tri + byte budgets
```

Claude runs the same `blender/build.py` inside a live Blender session over MCP (`runpy.run_path`). The generator always builds into its own `economizer` scene and never touches your other scenes. Build only one module per live session: object names are global per .blend, so a second module's shared parts get `.001` suffixes. The flow bakes refuse to run on a scene that fails the build's name check; use `npm run assets:build <module>` (headless) for the others. `.blend` and `.glb` files are build artifacts. See [docs/asset-conventions.md](docs/asset-conventions.md).

## Adding a module

1. Write `blender/modules/<slug>.py` using the part generators in `blender/parts/`. Build, compress, and validate it.
2. Create `src/modules/<slug>/` with `model.ts` (and tests), `bindings.ts`, `controls.ts`, `presets.ts`, `card.mdx`, and `index.ts`.
3. Add a registry entry with a `load` function.

## Design language

- **Forms:** the chassis follows Braun (hairlines, round nudge keys, a hi-fi fader, a slide switch for Auto/Manual). The controls follow Teenage Engineering (numbered square keys, colored encoders, a 16-step priority array, mono micro-labels).
- **Colors:** taken from sael.net's neutral palette. Dark is the house theme: `data-theme="dark"` is set on `<html>`. The light tokens still exist behind `data-theme="light"`.
- **3D:** light cel shading. Toon materials use four soft lighting bands, and each part gets a constant-width "inverted hull" ink outline (`src/lab/scene/toon.ts`). Cutaway panels fade their outlines along with the panel.
- **Drawn detail:** it only goes where it has a cause, following how comic-style games (Borderlands) and Moebius-style renderers place it.
  - Hatching appears only inside the key light's real cast shadows. It's screen-space pen strokes with a slight wobble: single strokes in shadow, and a cross-stroke only where neither light reaches.
  - Inner ink lines (`InkEdges.tsx`) come from a normal-buffer edge pass. They're heavier in crevices than on outside edges, with a slight hand-drawn waver. Fin packs, filter pleats and the fan wheel are left out.
  - Seams, rivets and hard metal glints are set per material. A soft paint grain and a little grime near the deck finish it.
  - All of it is tunable through `DETAIL` in `toon.ts` (live as `window.__detail` in dev).

Status colors are consistent everywhere:

- green = ok
- amber = fault (parts also pulse amber in 3D)
- blue with a hand icon = overridden
- red = alarm or safety

## Decisions on spec §9

- **Hosting:** standalone Next app with the same stack, deployed as a static export under robboborben.xyz/tools/bas-lab (see Deploy). `src/lab` and `src/modules` lift into BASidekick or a `lab.` subdomain unchanged.
- **Stylization:** clean product-model look, neither toy nor photoreal.
- **Shareable state:** presets via `?preset=`. Full custom state in the URL is not implemented yet.
- **Units:** °F only for now. The heat ramp and model are in °F, so a units toggle would be a display-layer change.
- **Blender connector:** the official Blender MCP.
