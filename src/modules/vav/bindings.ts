import type { Bindings, FlowBinding } from "@/lab/types";
import { asset } from "@/lib/basePath";
import { BOX, type VavInputs, type VavOutputs } from "./model";

const f0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toString() : "—");
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");

/** Diffuser throw: supply air mixing into the room as it goes */
const throwStream: FlowBinding<VavOutputs> = {
  rate: (o) => Math.min(1, 0.15 + o.q / 700),
  tempF: (o) => o.sat + 0.35 * (o.zone - o.sat),
  withField: true,
};
/** Room air drifting back up to the return grille */
const returnStream: FlowBinding<VavOutputs> = { rate: (o) => Math.min(1, 0.2 + o.q / 900), tempF: (o) => o.zone, withField: true };

export const bindings: Bindings<VavInputs, VavOutputs> = {
  // GLB drives (damperPos, actuatorPos) are already 0–1 outputs.

  // the key light plays the sun, so the tall walls don't throw the office into its shadow; the ceiling
  // still casts, so the ductwork only shades the plenum. The office has its own light (index.ts).
  noCastShadow: ["room_floor", "room_wall"],

  // Air through the branch, box, discharge and drops: solved on the real geometry at several damper
  // positions (blender/sims/vav_flow.py), sped up and slowed down with the airflow
  field: {
    url: asset("/lab/vav/flow.json"),
    position: (o) => o.damperPos,
    emit: { air: (o) => Math.min(1.2, 0.25 + o.airFlow * 1.5) },
    tempF: { air: (o) => o.sat },
    stages: {},
    speed: (o) => o.q / BOX.design,
  },

  flows: {
    // the supply main keeps going past this box to the others
    main: { rate: () => 0.85, tempF: (o) => o.sat, withField: true },
    // fallback for the branch and box if the field can't load
    box: { rate: (o) => Math.min(1, o.airFlow * 1.4), tempF: (o) => o.sat },
    // the room
    d1e: throwStream,
    d1w: throwStream,
    d1n: throwStream,
    d1s: throwStream,
    d2e: throwStream,
    d2w: throwStream,
    d2n: throwStream,
    d2s: throwStream,
    ret1: returnStream,
    ret2: returnStream,
  },

  highlights: [
    { parts: ["vav_damper_blade"], when: (o) => (o.stuck ? "fault" : null) },
    { parts: ["vav_flow_cross", "vav_sense_tubes"], when: (o) => (o.vpOffset !== 0 || o.kError !== 0 ? "fault" : null) },
    { parts: ["vav_controller"], when: (o) => (o.manual ? "overridden" : null) },
  ],

  callouts: [
    {
      anchor: "anchor_static",
      label: "DUCT PRESSURE",
      value: (o) => `${f2(o.staticIn)} in.`,
      tone: (o) => (o.starved ? "fault" : "neutral"),
      // just under the supply main's open front end: from the default camera the tap itself lines up with the airflow callout
      offset: [-0.69, -1.1, -0.515],
    },
    {
      anchor: "anchor_flow",
      label: "AIRFLOW",
      value: (o) => (o.independent ? `${f0(o.qBas)} · SP ${f0(o.flowSp)} cfm` : "not measured"),
      tone: (o) => (o.vpOffset !== 0 || o.kError !== 0 ? "fault" : o.starved ? "fault" : "cold"),
    },
    {
      anchor: "anchor_damper",
      label: "DAMPER",
      value: (o) => `CMD ${f0(o.cmd)} · FB ${f0(o.actuatorPct)}`,
      tone: (o) => (o.manual ? "overridden" : o.stuck ? "fault" : "neutral"),
      hand: (o) => o.manual === 1,
    },
    { anchor: "anchor_diffuser", label: "SUPPLY", value: (o) => `${f0(o.q)} cfm · ${f0(o.sat)}°F`, tone: () => "cold" },
    {
      anchor: "anchor_tstat",
      label: "ROOM",
      value: (o) => `${f1(o.zoneDisplayed)}°F · SP ${f1(o.zoneSp)}`,
      tone: (o) => (o.zoneDisplayed > o.zoneSp + 1 ? "warm" : o.zoneDisplayed < o.zoneSp - 1.5 ? "cold" : "neutral"),
    },
  ],

  status: (o) => {
    const chips: { label: string; state: "ok" | "off" | "fault" | "overridden" | "alarm" }[] = [
      { label: o.independent ? "Measures airflow" : "Pressure-dependent", state: "ok" },
      { label: o.manual ? "Manual override · P8" : "Auto · P16", state: o.manual ? "overridden" : "ok" },
    ];
    if (o.starved) chips.push({ label: "Starved · asking for more pressure", state: "alarm" });
    if (o.vpOffset) chips.push({ label: `Transducer drift ${o.vpOffset > 0 ? "+" : ""}${o.vpOffset.toFixed(3)} in.`, state: "fault" });
    if (o.kError) chips.push({ label: `Flow sensor ${o.kError > 0 ? "high" : "low"} ${f0(Math.abs(o.kError) * 100)}%`, state: "fault" });
    if (o.stuck) chips.push({ label: "Damper linkage slipped", state: "fault" });
    return chips;
  },

  describe: (o) =>
    `A VAV box above an office ceiling. Duct pressure at the box is ${f2(o.staticIn)} in.; the damper is ${f0(o.bladePct)} % open, ` +
    `moving ${f0(o.q)} cfm of ${f0(o.sat)} °F air while the box reads ${f0(o.qBas)} cfm. The room is ${f1(o.zone)} °F against a ${f1(o.zoneSp)} °F setpoint.`,

  legend: (o) => [
    { label: "SUPPLY", tempF: o.sat },
    { label: "ROOM", tempF: o.zone },
  ],

  // "Be the air": first-person trips along paths traced through the solved field (Blender coords, Z up)
  ride: {
    starts: [{ id: "supply", label: "Supply air", emit: "air", hint: "Peel off the supply main and ride through the box into the room." }],
    zones: [
      { label: "Diffuser", lo: [-9, -9, -9], hi: [9, 9, 2.8], note: () => "The diffuser's rings fling you out sideways along the ceiling, so you mix into the room instead of dropping on someone." },
      { label: "Flex drop", lo: [0.35, -9, -9], hi: [9, 9, 3.04], note: () => "Down the flex duct toward the ceiling." },
      { label: "Branch duct", lo: [-9, -9, -9], hi: [-0.86, 9, 9], note: (o) => `You peeled off the supply main, pushed along by ${f2(o.staticIn)} in. of duct pressure.` },
      {
        label: "Flow sensor",
        lo: [-0.86, -9, -9],
        hi: [-0.7, 9, 9],
        note: (o) =>
          o.independent
            ? `The flow cross feels you go by: ${o.vpTrue.toFixed(3)} in. of water. From that, the box works out ${f0(o.qBas)} cfm${Math.abs(o.readErrPct) > 8 ? `, but really it's ${f0(o.q)}` : ""}.`
            : "An older pressure-dependent box: there's nothing here measuring you.",
      },
      {
        label: "Damper",
        lo: [-0.7, -9, -9],
        hi: [-0.55, 9, 9],
        note: (o) =>
          o.independent
            ? `Squeezing past the damper blade, ${f0(o.bladePct)} % open. It burns off ${f2(o.dpDamper)} in. of pressure to hold you to ${f0(o.flowSp)} cfm.`
            : `Squeezing past the damper blade, ${f0(o.bladePct)} % open where the thermostat put it. How much air gets through is up to the duct pressure.`,
      },
      { label: "VAV box", lo: [-0.55, -9, -9], hi: [0.35, 9, 9], note: () => "Into the box, where you slow down and spread out." },
      { label: "Discharge duct", lo: [0.35, -9, -9], hi: [9, 9, 9], note: (o) => `On toward the room, still ${f0(o.sat)} °F.` },
    ],
    exits: [
      {
        label: "Into the room",
        lo: [-9, -9, -9],
        hi: [9, 9, 2.78],
        note: (o) =>
          `You're one of ${f0(o.q)} cfm of ${f0(o.sat)} °F air cooling this room. You'll mix in, pick up heat from people and screens, and drift back up through the return grille at about ${f0(o.zone)} °F.`,
      },
    ],
  },
};
