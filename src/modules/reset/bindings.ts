import type { Bindings, Callout, FlowBinding, Highlight, Tint } from "@/lab/types";
import { ZONES, zo, type ResetInputs, type ResetOutputs } from "./model";

type O = ResetOutputs;

const f0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toString() : "—");
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");

const share = (o: O, k: number) => zo(o, "q", k) / ZONES[k].design;

/** Branch, box, discharge and drop to each zone's diffuser */
const branch = (k: number): FlowBinding<O> => ({ rate: (o) => Math.min(1, 0.08 + share(o, k) * 1.5), tempF: (o) => o.sat });
/** The diffuser's throw: supply air mixing into the room as it goes */
const throwStream = (k: number): FlowBinding<O> => ({
  rate: (o) => Math.min(1, 0.12 + share(o, k) * 1.3),
  tempF: (o) => o.sat + 0.35 * (zo(o, "zone", k) - o.sat),
});

const flows: Record<string, FlowBinding<O>> = {
  ahu: { rate: (o) => Math.min(1, 0.15 + o.airFlow * 1.4), tempF: (o) => o.sat },
  main: { rate: (o) => Math.min(1, 0.15 + o.airFlow * 1.4), tempF: (o) => o.sat },
};
ZONES.forEach((_, k) => {
  const n = k + 1;
  flows[`b${n}`] = branch(k);
  for (const d of ["e", "w", "n", "s"]) flows[`t${n}${d}`] = throwStream(k);
});

const zoneTints: Tint<O>[] = ZONES.map((_, k) => ({
  parts: [`zone${k + 1}_floor`],
  tempF: (o) => zo(o, "zone", k),
  amount: 0.5,
}));

/** Starved and counted: asking 2 or 3 times */
const req2 = (o: O, k: number) => zo(o, "req", k) >= 2 && zo(o, "importance", k) > 0;

const zoneCallouts: Callout<O>[] = ZONES.map((z, k) => ({
  // over the zone's floor: the four rooms are spread out on screen where the boxes bunch up along the main
  anchor: `anchor_zone${k + 1}`,
  label: `VAV-${k + 1} · ${z.short.toUpperCase()}`,
  value: (o) => {
    const req = zo(o, "req", k);
    const asking = req ? ` · ${req} REQ${zo(o, "importance", k) > 0 ? "" : " (IGNORED)"}` : "";
    // the damper as the controller reports it (actuator feedback); the 3D blade shows the truth
    return `${f1(zo(o, "zoneSensor", k))}°F · ${f0(zo(o, "act", k))}%${asking}`;
  },
  tone: (o) => (zo(o, "rogue", k) ? "fault" : zo(o, "zoneSensor", k) > 76 ? "warm" : req2(o, k) ? "warm" : "neutral"),
}));
const rogueHighlights: Highlight<O>[] = ZONES.map((_, k) => ({
  parts: [`vav${k + 1}_controller`],
  when: (o) => (zo(o, "rogue", k) ? "fault" : null),
}));

export const bindings: Bindings<ResetInputs, O> = {
  // GLB drives (fanSpeed, damper1–4, actuator1–4) are already 0–1 outputs.

  // the key light plays the sun: the tall outside walls and the partitions don't throw the floor into shade
  noCastShadow: ["wall_", "partitions"],

  flows,
  tints: zoneTints,

  highlights: [
    { parts: ["vav2_damper_blade"], when: (o) => (o.slipped ? "fault" : null) },
    { parts: ["vav4_drop"], when: (o) => (o.crushed ? "fault" : null) },
    { parts: ["static_tap"], when: (o) => (o.sensorOffset !== 0 ? "fault" : null) },
    { parts: ["vfd", "fan_motor"], when: (o) => (o.manual ? "overridden" : null) },
    ...rogueHighlights,
  ],

  callouts: [
    {
      anchor: "anchor_fan",
      label: "SUPPLY FAN",
      value: (o) => `${f0(o.fanHz)} Hz · ${f2(o.kw)} kW`,
      tone: (o) => (o.manual ? "overridden" : "neutral"),
      hand: (o) => o.manual === 1,
    },
    {
      anchor: "anchor_static",
      label: "DUCT STATIC",
      value: (o) => `${f2(o.dsp)} · SP ${f2(o.sp)} in.`,
      tone: (o) => (o.sensorOffset !== 0 ? "fault" : "cold"),
    },
    ...zoneCallouts,
  ],

  status: (o) => {
    const chips: { label: string; state: "ok" | "off" | "fault" | "overridden" | "alarm" }[] = [
      { label: o.reset ? `Trim & respond · R ${o.requests} / I ${o.ignores}` : `Fixed setpoint ${f2(o.spMax)} in.`, state: "ok" },
      { label: o.manual ? "Fan in hand · P8" : "Fan auto · P16", state: o.manual ? "overridden" : "ok" },
    ];
    ZONES.forEach((z, k) => {
      if (zo(o, "rogue", k)) chips.push({ label: `Rogue zone: ${z.name} holding the static at max`, state: "alarm" });
    });
    if (o.slipped) chips.push({ label: "VAV-2 linkage slipped", state: "fault" });
    if (o.crushed) chips.push({ label: "VAV-4 flex crushed", state: "fault" });
    if (o.sensorOffset) chips.push({ label: `Static sensor ${o.sensorOffset > 0 ? "+" : ""}${f2(o.sensorOffset)} in.`, state: "fault" });
    return chips;
  },

  describe: (o) =>
    `An office floor with one air handler and four VAV boxes. The duct static setpoint is ${f2(o.sp)} in. (${o.reset ? "trim & respond" : "fixed"}); ` +
    `the fan runs at ${f0(o.fanHz)} Hz drawing ${f2(o.kw)} kW. ` +
    ZONES.map((z, k) => `${z.name}: ${f1(zo(o, "zone", k))} °F, damper ${f0(zo(o, "dmp", k))} %, ${zo(o, "req", k)} requests`).join("; ") +
    ".",

  legend: (o) => {
    let hot = 0;
    for (let k = 1; k < 4; k++) if (zo(o, "zone", k) > zo(o, "zone", hot)) hot = k;
    return [
      { label: "SUPPLY", tempF: o.sat },
      { label: "WARMEST", tempF: zo(o, "zone", hot) },
    ];
  },
};
