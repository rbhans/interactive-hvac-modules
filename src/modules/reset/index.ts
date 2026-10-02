import type { LabModule } from "@/lab/types";
import { asset } from "@/lib/basePath";
import { bindings } from "./bindings";
import Card from "./card.mdx";
import { controls } from "./controls";
import { glossary } from "./glossary";
import { init, outputs, step, type ResetInputs, type ResetOutputs, type ResetState } from "./model";
import { presets } from "./presets";

const reset: LabModule<ResetInputs, ResetState, ResetOutputs> = {
  slug: "static-reset",
  number: "04",
  title: "Static pressure reset",
  insight: "Trim & respond, one request at a time.",
  intro:
    "One air handler, four VAV boxes, and one number that decides how hard the fan works: the duct static pressure setpoint. Hold it fixed for the hottest day and every box spends all year throttling. Let the boxes ask for more and the fan can do a lot less, until one box asks for the wrong reasons. Switch the setpoint, load a preset, and break things. The 3D view shows the air and each zone's temperature, and the panel shows what the control system thinks is happening.",
  glossary,
  glb: asset("/lab/reset/scene.glb"),
  camera: { position: [-7.9, 10.4, 14.2], target: [-1.0, 1.0, 0.2], fov: 32 },
  model: { init, step, outputs },
  bindings,
  controls,
  presets,
  defaultPreset: "reset",
  samplePeriod: 0.5,
  Card,
  cardSections: [
    { id: "basics", title: "The basics" },
    { id: "fixed", title: "A fixed setpoint" },
    { id: "trim-respond", title: "Trim & respond" },
    { id: "critical", title: "The critical zone" },
    { id: "rogue", title: "Rogue zones" },
    { id: "ignores", title: "How many to ignore" },
  ],
};

export default reset;
