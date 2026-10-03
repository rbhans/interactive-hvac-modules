import type { LabModule } from "@/lab/types";
import { asset } from "@/lib/basePath";
import { bindings } from "./bindings";
import Card from "./card.mdx";
import { controls } from "./controls";
import { glossary } from "./glossary";
import { init, outputs, step, type ValveInputs, type ValveOutputs, type ValveState } from "./model";
import { presets } from "./presets";

const valves3: LabModule<ValveInputs, ValveState, ValveOutputs> = {
  slug: "three-way-valves",
  number: "06",
  title: "Three-way vs. two-way valves",
  insight: "Three-way valves keep the pump at full speed.",
  intro:
    "A pump on a drive and three cooling coils. Each coil's valve can send the water its coil doesn't need around it (three-way) or cut the flow (two-way). Same coils, same cooling; very different pumps and very different water going back to the chillers. Flip the valves, load a preset, and break things. The 3D view shows the water moving through the pipes, and the panel shows what the control system thinks is happening.",
  glossary,
  glb: asset("/lab/valves3/scene.glb"),
  camera: { position: [-3.2, 3.6, 7.8], target: [0.0, 1.45, 0.3], fov: 32 },
  model: { init, step, outputs },
  bindings,
  controls,
  presets,
  defaultPreset: "three",
  Card,
  cardSections: [
    { id: "basics", title: "The basics" },
    { id: "around", title: "Around instead of through" },
    { id: "warm", title: "The water that goes back" },
    { id: "minimum", title: "Not too far" },
  ],
};

export default valves3;
