import type { Bindings } from "@/lab/types";
import { asset } from "@/lib/basePath";
import type { CoilInputs, CoilOutputs } from "./model";

const f0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toString() : "—");
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");
const water = (flow: number) => Math.min(1, Math.max(0, flow / 1.05));

export const bindings: Bindings<CoilInputs, CoilOutputs> = {
  // GLB drives: chwValvePos, hwValvePos, fanSpeed (0–1 outputs)

  // Air: solved on the real geometry (blender/sims/coils_flow.py); it picks up each coil's temperature as it passes
  field: {
    url: asset("/lab/coils/flow.json"),
    position: () => 0,
    emit: { air: (o) => o.airFlow },
    tempF: { air: (o) => o.eat },
    stages: { hw: (o) => o.afterHw, chw: (o) => o.datTrue },
  },

  flows: {
    // fallback air path if the field can't load
    air: { rate: (o) => o.airFlow, tempF: (o) => o.eat },
    // water in the pipes
    chws: { rate: (o) => water(o.chwFlow), tempF: (o) => o.chwEwt, medium: "water" },
    chwr: { rate: (o) => water(o.chwFlow), tempF: (o) => o.chwLwt, medium: "water" },
    hws: { rate: (o) => water(o.hwFlow), tempF: (o) => o.hwEwt, medium: "water" },
    hwr: { rate: (o) => water(o.hwFlow), tempF: (o) => o.hwLwt, medium: "water" },
  },

  // pipes wear their water temperature; a working coil's fins take on a hint of it
  tints: [
    { parts: ["chw_supply_pipe"], tempF: (o) => o.chwEwt, amount: 0.5 },
    { parts: ["chw_return_pipe"], tempF: (o) => o.chwLwt, amount: 0.5 },
    { parts: ["hw_supply_pipe"], tempF: (o) => o.hwEwt, amount: 0.5 },
    { parts: ["hw_return_pipe"], tempF: (o) => o.hwLwt, amount: 0.5 },
    { parts: ["chw_coil_fins"], tempF: (o) => (o.chwEwt + o.chwLwt) / 2, amount: 0.4, when: (o) => o.chwFlow > 0.01 },
    { parts: ["hw_coil_fins"], tempF: (o) => (o.hwEwt + o.hwLwt) / 2, amount: 0.35, when: (o) => o.hwFlow > 0.01 },
  ],

  condensate: { from: ["drip_a", "drip_b"], to: "drip_pan", rate: (o) => o.condensate },

  highlights: [
    { parts: ["chw_valve_stem", "chw_valve_indicator"], when: (o) => (o.stuckChw ? "fault" : null) },
    { parts: ["hw_valve_stem", "hw_valve_indicator"], when: (o) => (o.stuckHw ? "fault" : null) },
    { parts: ["hw_valve"], when: (o) => (o.hwLeak > 0 ? "fault" : null) },
    { parts: ["chw_valve"], when: (o) => (o.chwLeak > 0 ? "fault" : null) },
    { parts: ["dat_sensor"], when: (o) => (o.datOffset !== 0 ? "fault" : null) },
    { parts: ["chw_valve_actuator"], when: (o) => (o.manual && o.cooling ? "overridden" : null) },
    { parts: ["hw_valve_actuator"], when: (o) => (o.manual && !o.cooling ? "overridden" : null) },
  ],

  callouts: [
    { anchor: "anchor_eat", label: "ENTERING", value: (o) => `${f0(o.eat)}°F`, tone: (o) => (o.eat < 60 ? "cold" : "warm") },
    {
      anchor: "anchor_hw",
      label: "HEATING",
      value: (o) => `+${f1(Math.max(0, o.hwRise))}°F`,
      tone: (o) => (o.cooling && o.hwRise > 0.5 ? "fault" : "warm"),
      when: (o) => !o.cooling || o.hwRise > 0.5,
    },
    {
      anchor: "anchor_chw",
      label: "COOLING",
      value: (o) => `−${f1(Math.max(0, o.chwDrop))}°F`,
      tone: (o) => (!o.cooling && o.chwDrop > 0.5 ? "fault" : "cold"),
      when: (o) => o.cooling === 1 || o.chwDrop > 0.5,
    },
    { anchor: "anchor_dat", label: "DISCHARGE", value: (o) => `${f1(o.datDisplayed)}°F`, tone: (o) => (o.datOffset ? "fault" : "neutral") },
    {
      anchor: "anchor_chw_valve",
      label: "CHW VALVE",
      value: (o) => (o.cooling ? `CMD ${f0(o.cmd)} · FB ${f0(o.actuatorPct)}` : o.stuckChw ? "CMD 0 · STEM STUCK" : o.chwLeak > 0 ? "0% · LEAKING" : "SHUT"),
      tone: (o) => (o.chwLeak > 0 ? "fault" : o.cooling && o.manual ? "overridden" : o.stuckChw ? "fault" : "neutral"),
      hand: (o) => o.cooling === 1 && o.manual === 1,
    },
    {
      anchor: "anchor_hw_valve",
      label: "HW VALVE",
      value: (o) => (!o.cooling ? `CMD ${f0(o.cmd)} · FB ${f0(o.actuatorPct)}` : o.stuckHw ? "CMD 0 · STEM STUCK" : o.hwLeak > 0 ? "0% · LEAKING" : "SHUT"),
      tone: (o) => (o.hwLeak > 0 ? "fault" : !o.cooling && o.manual ? "overridden" : o.stuckHw ? "fault" : "neutral"),
      hand: (o) => o.cooling === 0 && o.manual === 1,
    },
    { anchor: "anchor_pan", label: "CONDENSATE", value: () => "dripping", tone: () => "cold", when: (o) => o.condensate > 0.05 },
  ],

  status: (o) => {
    const chips: { label: string; state: "ok" | "off" | "fault" | "overridden" | "alarm" }[] = [
      { label: o.cooling ? "Cooling · chilled water" : "Heating · hot water", state: "ok" },
      { label: o.manual ? "Manual override · P8" : "Auto · P16", state: o.manual ? "overridden" : "ok" },
    ];
    if (o.hwLeak > 0) chips.push({ label: `Heating valve leaking ${f0(o.hwLeak * 100)}%`, state: "fault" });
    if (o.chwLeak > 0) chips.push({ label: `Cooling valve leaking ${f0(o.chwLeak * 100)}%`, state: "fault" });
    if (o.stuck) chips.push({ label: "Valve stem stuck", state: "fault" });
    if (o.datOffset) chips.push({ label: `Discharge sensor ${o.datOffset > 0 ? "+" : ""}${o.datOffset}°F`, state: "fault" });
    return chips;
  },

  describe: (o) =>
    `Coil section in ${o.cooling ? "cooling" : "heating"}. Air enters at ${f0(o.eat)}°F and leaves at ${f1(o.datTrue)}°F. ` +
    `The active valve is ${f0(o.stemPct)}% open, passing ${f0(o.flowOfMax)}% of its full water flow and delivering ${f0(Math.max(0, o.capOfMax))}% of the coil's capacity.`,

  legend: (o) => [
    { label: "IN", tempF: o.eat },
    { label: "OUT", tempF: o.datTrue },
  ],

  // "Be the air": first-person trips along paths traced through the solved field (Blender coords, Z up)
  ride: {
    starts: [{ id: "air", label: "Mixed air", emit: "air", hint: "Arrive from the mixing box and ride through both coils." }],
    zones: [
      { label: "Arriving", lo: [-9, -9, -9], hi: [-1.66, 9, 9], note: (o) => `Mixed air at ${f0(o.eat)}°F, fresh from the mixing box upstream.` },
      { label: "Filter", lo: [-1.66, -9, -9], hi: [-1.54, 9, 9], note: () => "Through the pleated filter." },
      {
        label: "Heading for the heating coil",
        lo: [-1.54, -9, -9],
        hi: [-1.01, 9, 9],
        note: (o) =>
          o.cooling
            ? o.hwLeak > 0
              ? "Its valve says shut. It isn't, quite."
              : "Heating's off: its valve is shut, so nothing's flowing in it."
            : `Its valve is ${f0(o.stemPct)}% open, passing ${f0(o.flowOfMax)}% of its full hot water.`,
      },
      {
        label: "Heating coil",
        lo: [-1.01, -9, -9],
        hi: [-0.89, 9, 9],
        note: (o) =>
          o.hwRise > 0.3
            ? `Hot fins warm you ${f1(o.hwRise)}°F${o.cooling ? ", even though this coil is supposed to be off" : ""}.`
            : "Cold fins, no hot water. You slip straight through.",
      },
      { label: "Between the coils", lo: [-0.89, -9, -9], hi: [-0.425, 9, 9], note: (o) => `${f1(o.afterHw)}°F now. Next, the cooling coil.` },
      {
        label: "Cooling coil",
        lo: [-0.425, -9, -9],
        hi: [-0.175, 9, 9],
        note: (o) =>
          o.chwDrop > 0.3
            ? `Squeezing between fins a couple of millimeters apart. Chilled water pulls ${f1(o.chwDrop)}°F out of you${o.condensate > 0.05 ? ", and some of your moisture condenses onto the fins" : ""}.`
            : "No chilled water flowing. You slip straight through.",
      },
      {
        label: "Discharge sensor",
        lo: [-0.175, -9, -9],
        hi: [0.3, 9, 9],
        note: (o) =>
          o.datOffset
            ? `The sensor reads you as ${f1(o.datDisplayed)}°F. You're really ${f1(o.datTrue)}°F.`
            : `The discharge sensor takes your temperature: ${f1(o.datDisplayed)}°F.`,
      },
      { label: "Fan", lo: [0.3, -9, -9], hi: [1.3, 9, 9], note: () => "Sucked into the fan inlet and flung outward by the spinning wheel." },
      { label: "Supply duct", lo: [1.3, -9, -9], hi: [9, 9, 9], note: (o) => `On your way to the building at ${f1(o.datTrue)}°F.` },
    ],
    exits: [
      {
        label: "Into the building",
        lo: [2.4, -9, -9],
        hi: [9, 9, 9],
        note: (o) => `You're supply air now, at ${f1(o.datTrue)}°F. From here you'll ${o.cooling ? "cool" : "warm"} a room, then come back for another lap.`,
      },
    ],
  },
};
