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
};
