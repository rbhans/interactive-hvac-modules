import type { LabModule } from "@/lab/types";
import { asset } from "@/lib/basePath";
import { bindings } from "./bindings";
import Card from "./card.mdx";
import { controls } from "./controls";
import { glossary } from "./glossary";
import { init, outputs, step, type VavInputs, type VavOutputs, type VavState } from "./model";
import { presets } from "./presets";

const vav: LabModule<VavInputs, VavState, VavOutputs> = {
  slug: "vav-box",
  number: "03",
  title: "VAV box",
  insight: "Pressure-independent doesn't mean pressure-proof.",
  intro:
    "Above most office ceilings, every room gets its cool air through a small box with a damper in it. A good box measures its airflow and holds it no matter how the duct pressure swings. But it can only hold back air, not make it, and at low airflows it can barely tell how much it's moving. Change the duct pressure, load a preset, and break things. The 3D view shows the air, and the panel shows what the control system thinks is happening.",
  glossary,
  glb: asset("/lab/vav/scene.glb"),
  camera: { position: [-3.7, 4.0, 6.3], target: [0.2, 2.15, 0.0], fov: 32 },
  // the office is lit by its ceiling lights: soft light from above, no shadows
  lights: [{ position: [0.6, 10, 1.2], intensity: 1.3, color: "#fff8ee" }],
  model: { init, step, outputs },
  bindings,
  controls,
  presets,
  defaultPreset: "steady",
  Card,
  cardSections: [
    { id: "basics", title: "The basics" },
    { id: "independent", title: "Measuring the air" },
    { id: "starved", title: "Not enough pressure" },
    { id: "blind", title: "The low-flow blind spot" },
    { id: "too-much", title: "Too much pressure" },
  ],
};

export default vav;
