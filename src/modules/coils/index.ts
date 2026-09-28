import type { LabModule } from "@/lab/types";
import { bindings } from "./bindings";
import Card from "./card.mdx";
import { controls } from "./controls";
import { glossary } from "./glossary";
import { init, outputs, step, type CoilInputs, type CoilOutputs, type CoilState } from "./model";
import { presets } from "./presets";

const coils: LabModule<CoilInputs, CoilState, CoilOutputs> = {
  slug: "coils",
  number: "02",
  title: "Coils & valves",
  insight: "Half the water does most of the work.",
  intro:
    "Inside the air handler, air passes through a heating coil and a cooling coil, each fed with water through a valve. Opening a valve halfway doesn't give half the heating or cooling, and that shapes everything about how valves are picked and tuned. Switch between the coils, load a preset, and break things. The 3D unit shows the water and air, and the panel shows what the control system thinks is happening.",
  glossary,
  glb: "/lab/coils/scene.glb",
  camera: { position: [-3.3, 2.9, 6.0], target: [-0.3, 0.72, 0.15], fov: 32 },
  model: { init, step, outputs },
  bindings,
  controls,
  presets,
  defaultPreset: "warm-afternoon",
  Card,
  cardSections: [
    { id: "basics", title: "The basics" },
    { id: "half", title: "Half the water" },
    { id: "valves", title: "Valve shape" },
    { id: "wide-open", title: "Wide open isn't free" },
    { id: "leak", title: "A leaking valve" },
  ],
};

export default coils;
