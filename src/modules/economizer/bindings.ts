import type { Bindings } from "@/lab/types";
import { asset } from "@/lib/basePath";
import type { EconInputs, EconOutputs } from "./model";

const f0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toString() : "—");
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");

export const bindings: Bindings<EconInputs, EconOutputs> = {
  // GLB drives (oaBladePos, raBladePos, eaBladePos, actuatorPos, fanSpeed) are already 0–1 outputs.

  flows: {
    oa: { rate: (o) => o.oaFlow, tempF: (o) => o.oat },
    ra: { rate: (o) => o.raFlow, tempF: (o) => o.rat },
    ea: { rate: (o) => o.eaFlow, tempF: (o) => o.rat },
    ma: { rate: (o) => o.maFlow, tempF: (o) => o.matTrue },
  },

  // Airflow solved on the real geometry at several damper positions (blender/sims/economizer_flow.py)
  field: {
    url: asset("/lab/economizer/flow.json"),
    position: (o) => o.oaBladePos,
    emit: { oa: (o) => o.oaFlow, ra: (o) => o.raFlow + o.eaFlow },
    tempF: { oa: (o) => o.oat, ra: (o) => o.rat },
    stages: { mix: (o) => o.matTrue },
  },

  highlights: [
    // the slipped coupling: blades and jackshaft linkage are the faulted parts, not the actuator
    { parts: ["oa_blade_", "oa_crank", "link_rod_", "ea_crank", "ea_blade_", "ra_blade_", "ra_crank"], when: (o) => (o.stuck ? "fault" : null) },
    { parts: ["mat_sensor"], when: (o) => (o.matOffset !== 0 ? "fault" : null) },
    { parts: ["oa_actuator"], when: (o) => (o.manual ? "overridden" : null) },
  ],

  callouts: [
    {
      anchor: "anchor_oa",
      label: "OUTSIDE",
      value: (o) => `${f0(o.oat)}°F · ${f0(o.oaPct)}% of mix`,
      tone: (o) => (o.oat < o.rat ? "cold" : "warm"),
    },
    { anchor: "anchor_ra", label: "RETURN", value: (o) => `${f1(o.rat)}°F`, tone: () => "neutral" },
    {
      anchor: "anchor_mat",
      label: "MIXED",
      value: (o) => `${f1(o.matDisplayed)}°F`,
      tone: (o) => (o.matOffset !== 0 ? "fault" : "neutral"),
    },
    {
      anchor: "anchor_actuator",
      label: "DAMPER",
      value: (o) => `${o.freezeStage ? "P5 " : ""}CMD ${f0(o.cmd)} · FB ${f0(o.actuatorPosPct)}`,
      tone: (o) => (o.freezeStage ? "fault" : o.manual ? "overridden" : o.stuck ? "fault" : "neutral"),
      hand: (o) => o.manual === 1 && !o.freezeStage,
    },
    {
      anchor: "anchor_ea",
      label: "RELIEF",
      value: (o) => `${f0(o.eaFlow * 100)}%`,
      tone: () => "neutral",
    },
  ],

  // Parallel-blade variant: every blade in a damper turns the same way as its drive shaft.
  range: (node, authored, inputs, lookup) => {
    if (inputs.bladeType !== "parallel") return authored;
    const m = /^([a-z]+)_blade_\d+$/.exec(node);
    if (!m) return authored;
    const ref = lookup(`${m[1]}_crank`) ?? lookup(`${m[1]}_blade_01`);
    if (!ref) return authored;
    const sign = Math.sign(ref[1] || ref[0]) || 1;
    return [authored[0], Math.abs(authored[1]) * sign];
  },

  status: (o) => {
    const chips: { label: string; state: "ok" | "off" | "fault" | "overridden" | "alarm" }[] = [
      o.econEnabled ? { label: "Free cooling on", state: "ok" } : { label: "Free cooling off · too warm out", state: "off" },
      o.freezeStage
        ? { label: `Freeze protection · P5 · damper ${o.freezeStage === 2 ? "closed" : "at minimum"}`, state: "alarm" as const }
        : { label: o.manual ? "Manual override · P8" : "Auto · P16", state: o.manual ? "overridden" : "ok" },
    ];
    if (o.stuck) chips.push({ label: "Linkage slipped", state: "fault" });
    if (o.matOffset) chips.push({ label: `Mixed-air sensor ${o.matOffset > 0 ? "+" : ""}${o.matOffset}°F`, state: "fault" });
    return chips;
  },

  describe: (o) =>
    `Mixing box. Outdoor air ${f0(o.oat)}°F, return air ${f1(o.rat)}°F. OA damper blades at ${f0(o.bladePosPct)}% open, admitting ${f0(o.oaPct)}% outdoor air. Mixed air ${f1(o.matTrue)}°F.`,

  legend: (o) => [
    { label: "OUT", tempF: o.oat },
    { label: "MIX", tempF: o.matTrue },
    { label: "RET", tempF: o.rat },
  ],

  // "Be the air": first-person trips along paths traced through the solved field (Blender coords, Z up)
  ride: {
    starts: [
      { id: "oa", label: "Outside air", emit: "oa", hint: "Start outdoors and get pulled into the unit." },
      { id: "ra", label: "Return air", emit: "ra", hint: "Start in the duct back from the rooms. Where you end up depends on the dampers." },
    ],
    zones: [
      { label: "Back outside", lo: [-9, -9, 1.36], hi: [-1.26, 9, 9], note: () => "Pushed out through the relief damper into the open air." },
      {
        label: "Relief damper",
        lo: [-1.26, -9, 1.36],
        hi: [-1.08, 9, 9],
        note: (o) => `Squeezing between the relief damper's blades, ${f0(o.bladePosPct)}% open, on the way out of the building.`,
      },
      { label: "Outdoors", lo: [-9, -9, -9], hi: [-1.26, 9, 1.36], note: (o) => `Fresh air at ${f0(o.oat)}°F, drawn toward the intake by the fan.` },
      {
        label: "Outside-air damper",
        lo: [-1.26, -9, -9],
        hi: [-1.08, 9, 1.36],
        note: (o) => `Slipping between the damper blades. They're ${f0(o.bladePosPct)}% open, but only ${f0(o.oaPct)}% of the air is coming in from outside.`,
      },
      { label: "Return duct", lo: [-1.08, -9, 1.38], hi: [9, 9, 9], note: (o) => `On your way back from the rooms at ${f0(o.rat)}°F.` },
      {
        label: "Return damper",
        lo: [-0.98, -9, 1.2],
        hi: [-0.12, 9, 1.38],
        note: (o) => `Dropping through the return damper, ${f0(100 - o.bladePosPct)}% open, into the mixing box.`,
      },
      {
        label: "Mixing box",
        lo: [-1.08, -9, -9],
        hi: [0.24, 9, 1.38],
        note: (o) => `Outside and return air tumble together here and come out around ${f1(o.matTrue)}°F.`,
      },
      { label: "Filter", lo: [0.24, -9, -9], hi: [0.42, 9, 1.38], note: () => "Through the pleated filter. The dust you picked up outside stays here." },
      { label: "Fan", lo: [0.42, -9, -9], hi: [1.4, 9, 1.38], note: () => "Sucked into the fan inlet and flung outward by the spinning wheel." },
      { label: "Supply duct", lo: [1.4, -9, -9], hi: [9, 9, 1.36], note: (o) => `Off to the building at ${f1(o.matTrue)}°F.` },
    ],
    exits: [
      {
        label: "Into the building",
        lo: [2.4, -9, -9],
        hi: [9, 9, 1.36],
        note: (o) => `You're supply air now, at about ${f0(o.matTrue)}°F. You'll cool a room for a while, then come back through the return duct.`,
      },
      {
        label: "Back outside",
        lo: [-9, -9, 1.3],
        hi: [-1.3, 9, 9],
        note: (o) =>
          `The relief damper pushed you out. Right now about ${f0((100 * o.eaFlow) / Math.max(1e-6, o.eaFlow + o.raFlow))}% of the air coming back from the rooms leaves this way, to make room for fresh air.`,
      },
    ],
  },
};
