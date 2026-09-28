import type { LabModule } from "@/lab/types";
import { bindings } from "./bindings";
import Card from "./card.mdx";
import { controls } from "./controls";
import { glossary } from "./glossary";
import { init, outputs, step, type EconInputs, type EconOutputs, type EconState } from "./model";
import { presets } from "./presets";

const economizer: LabModule<EconInputs, EconState, EconOutputs> = {
  slug: "economizer",
  number: "01",
  title: "Economizer",
  insight: "Damper position isn't outdoor-air percentage.",
  intro:
    "Every large building mixes fresh outside air with air coming back from the rooms. When it's cool outside, more outside air means free cooling. Play with the weather, load a preset, and break things. The 3D unit shows what the air is really doing, and the panel shows what the control system thinks is happening.",
  glossary,
  glb: "/lab/economizer/scene.glb",
  camera: { position: [-4.2, 3.9, 7.7], target: [0.2, 0.6, 0], fov: 32 },
  model: { init, step, outputs },
  bindings,
  controls,
  presets,
  defaultPreset: "mild-day",
  Card,
  cardSections: [
    { id: "basics", title: "The basics" },
    { id: "position", title: "Position ≠ percentage" },
    { id: "min-oa", title: "What minimum outside air is for" },
    { id: "high-limit", title: "Why free cooling shuts off" },
    { id: "stuck", title: "A stuck damper, on a graphic" },
  ],
};

export default economizer;
