import type { LabModule } from "@/lab/types";
import { asset } from "@/lib/basePath";
import { bindings } from "./bindings";
import Card from "./card.mdx";
import { controls } from "./controls";
import { glossary } from "./glossary";
import { init, outputs, step, type PumpInputs, type PumpOutputs, type PumpState } from "./model";
import { presets } from "./presets";

const pumps: LabModule<PumpInputs, PumpState, PumpOutputs> = {
  slug: "pumps",
  number: "05",
  title: "Pumps & VFDs",
  insight: "Slow the pump, don't choke it.",
  intro:
    "A chilled-water pump, picked for 400 gpm at 70 ft. Most of the time the building needs less, and there are two ways to give it less: choke the pump with a valve, or slow it down with its drive. Same water either way, and very different power. Switch the method, load a preset, and break things. The 3D view shows the water moving through the pipes, and the panel shows what the control system thinks is happening.",
  glossary,
  glb: asset("/lab/pumps/scene.glb"),
  camera: { position: [-3.9, 3.6, 6.6], target: [-0.55, 1.3, 0.25], fov: 32 },
  model: { init, step, outputs },
  bindings,
  controls,
  presets,
  defaultPreset: "slowed",
  Card,
  cardSections: [
    { id: "basics", title: "The basics" },
    { id: "two-ways", title: "Choke it or slow it" },
    { id: "oversized", title: "One size up" },
    { id: "faults", title: "When the numbers don't add up" },
  ],
};

export default pumps;
