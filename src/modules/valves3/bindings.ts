import type { Bindings, Callout, FlowBinding, Tint } from "@/lab/types";
import { co, type ValveInputs, type ValveOutputs } from "./model";

type O = ValveOutputs;

const f0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toString() : "—");
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");

// liquid cores just inside the bare pipe: 4" mains, 2.5" branches
const MAIN = 0.052;
const BRANCH = 0.033;
const water = (rate: (o: O) => number, tempF: (o: O) => number, radius: number): FlowBinding<O> => ({ rate, tempF, medium: "water", radius });

const flows: Record<string, FlowBinding<O>> = {
  suc: water((o) => o.flowShare, (o) => o.supplyT, MAIN),
  sup: water((o) => o.flowShare, (o) => o.supplyT, MAIN),
  ret: water((o) => o.flowShare, (o) => o.returnT, MAIN),
};
for (const k of [0, 1, 2]) {
  const n = k + 1;
  flows[`s${n}`] = water((o) => co(o, "branchQ", k) / 100, (o) => o.supplyT, BRANCH);
  flows[`c${n}`] = water((o) => co(o, "coilRate", k), (o) => co(o, "lwt", k), BRANCH);
  flows[`r${n}`] = water((o) => co(o, "branchQ", k) / 100, (o) => co(o, "branchT", k), BRANCH);
  flows[`b${n}`] = water((o) => co(o, "bypassRate", k), (o) => o.supplyT, BRANCH);
}

const pipes = ["sup_main", "ret_main", "suction", ...[1, 2, 3].flatMap((n) => [`s${n}_pipe`, `r${n}_pipe`, `b${n}_pipe`])];

// a coil's fins take on its water's color as hard as it's working
const tints: Tint<O>[] = [0, 1, 2].map((k) => ({
  parts: [`coil${k + 1}_fins`],
  tempF: (o) => o.supplyT + 0.35 * (co(o, "lwt", k) - o.supplyT),
  amount: (o) => 0.2 + 0.6 * Math.min(1, co(o, "delivered", k) / 100),
}));

const ahuCallouts: Callout<O>[] = [0, 1, 2].map((k) => ({
  anchor: `anchor_ahu${k + 1}`,
  label: `AHU-${k + 1}`,
  value: (o) =>
    co(o, "three", k)
      ? `3-WAY · ${f0(co(o, "coilQ", k))} through, ${f0(co(o, "bypassQ", k))} around`
      : `2-WAY · ${f0(co(o, "coilQ", k))} gpm, out at ${f0(co(o, "lwt", k))}°F`,
  tone: (o) => (k === 0 && o.bypassOpen ? "fault" : "cold"),
}));

export const bindings: Bindings<ValveInputs, O> = {
  // GLB drives (pumpSpeed, valvePos1–3) are already 0–1 outputs.
  noCastShadow: ["wall_back"],
  liquid: { pipes },
  flows,
  tints,

  highlights: [
    { parts: ["bv1"], when: (o) => (o.bypassOpen ? "fault" : null) },
    { parts: ["pump_motor"], when: (o) => (o.manual ? "overridden" : null) },
  ],

  callouts: [
    ...ahuCallouts,
    {
      anchor: "anchor_pump",
      label: "PUMP",
      value: (o) => `${f0(o.hz)} Hz · ${f2(o.kw)} kW`,
      tone: (o) => (o.manual ? "overridden" : "neutral"),
      hand: (o) => o.manual === 1,
    },
    {
      anchor: "anchor_dp",
      label: "DP",
      value: (o) => `${f1(o.dp)} · SP ${f0(o.dpSp)} ft`,
      tone: (o) => (o.dp < o.dpSp - 0.8 ? "fault" : "neutral"),
    },
    {
      anchor: "anchor_supply",
      label: "FROM CHILLER",
      value: (o) => `${f0(o.supplyT)}°F · ${f0(o.total)} gpm`,
      tone: (o) => (o.lowFlow ? "fault" : "cold"),
    },
    {
      anchor: "anchor_return",
      label: "TO CHILLER",
      value: (o) => `${f1(o.returnT)}°F · ΔT ${f1(o.deltaT)}`,
      tone: (o) => (o.deltaT < 8 ? "warm" : "neutral"),
    },
  ],

  status: (o) => {
    const chips: { label: string; state: "ok" | "off" | "fault" | "overridden" | "alarm" }[] = [
      { label: `${o.threeWays} three-way · ${3 - o.threeWays} two-way`, state: "ok" },
      { label: o.manual ? "Pump in Hand · P8" : "Pump auto · P16", state: o.manual ? "overridden" : "ok" },
    ];
    if (o.lowFlow) chips.push({ label: "Below the chiller's minimum flow", state: "alarm" });
    if (o.bypassOpen) chips.push({ label: "AHU-1 bypass wide open", state: "fault" });
    return chips;
  },

  describe: (o) =>
    `A chilled-water loop: a pump on a drive and three coils, ${o.threeWays} with three-way valves and ${3 - o.threeWays} working as two-way. ` +
    `At ${f0(o.load)} % load the loop moves ${f0(o.total)} gpm with the pump at ${f0(o.hz)} Hz and ${f2(o.kw)} kW; the water goes back at ${f1(o.returnT)} °F.`,

  legend: (o) => [
    { label: "SUPPLY", tempF: o.supplyT },
    { label: "RETURN", tempF: o.returnT },
  ],
};
