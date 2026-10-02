import type { Bindings } from "@/lab/types";
import { PSI_PER_FT, type PumpInputs, type PumpOutputs } from "./model";

type O = PumpOutputs;

const f0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toString() : "—");
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "—");
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");

export const bindings: Bindings<PumpInputs, O> = {
  // GLB drives (pumpSpeed, valveTravel, suctionGauge, dischargeGauge) are already 0–1 outputs.

  // wired backwards, the impeller turns the other way
  range: (node, authored, inputs) => (node === "pump_impeller" && inputs.faults.reversed ? [authored[0], -authored[1]] : authored),

  noCastShadow: ["wall_back"],

  // the insulated pipes turn see-through in the cutaway view, the chilled water flowing inside them
  liquid: { pipes: ["suction_pipe", "discharge_pipe"] },

  flows: {
    // cores just inside the bare pipe (5" suction, 4" discharge)
    suc: { rate: (o) => Math.min(1.2, o.flowShare), tempF: (o) => o.chwTemp, medium: "water", radius: 0.065 },
    dis: { rate: (o) => Math.min(1.2, o.flowShare), tempF: (o) => o.chwTemp, medium: "water", radius: 0.052 },
  },

  highlights: [
    { parts: ["suction_strainer"], when: (o) => (o.clog >= 0.3 ? "fault" : null) },
    { parts: ["pump_motor"], when: (o) => (o.reversed ? "fault" : null) },
    { parts: ["vfd"], when: (o) => (o.manual ? "overridden" : null) },
  ],

  callouts: [
    {
      anchor: "anchor_meter",
      label: "FLOW",
      value: (o) => `${f0(o.qMeter)} · SP ${f0(o.flowSp)} gpm`,
      tone: (o) => (o.short ? "fault" : "cold"),
    },
    {
      anchor: "anchor_pump",
      label: "PUMP",
      value: (o) => `${f0(o.hz)} Hz · ${f2(o.kw)} kW`,
      tone: (o) => (o.manual ? "overridden" : o.reversed ? "fault" : "neutral"),
      hand: (o) => o.manual === 1,
    },
    {
      anchor: "anchor_valve",
      label: "TRIPLE-DUTY VALVE",
      value: (o) => (o.hValve > 1 ? `${f0(o.valvePct)}% · burns ${f0(o.hValve)} ft` : `${f0(o.valvePct)}% open`),
      tone: (o) => (o.hValve > 10 ? "warm" : "neutral"),
    },
    {
      anchor: "anchor_gauges",
      label: "GAUGES",
      value: (o) => `${f0(o.suction)} → ${f0(o.discharge)} psi · ${f0(o.head)} ft`,
      tone: (o) => (o.reversed ? "fault" : "neutral"),
    },
    {
      anchor: "anchor_strainer",
      label: "STRAINER",
      value: (o) => `loses ${f1(o.hStrainer * PSI_PER_FT)} psi`,
      tone: (o) => (o.clog >= 0.3 ? "fault" : "neutral"),
      when: (o) => o.clog > 0.05,
    },
  ],

  status: (o) => {
    const chips: { label: string; state: "ok" | "off" | "fault" | "overridden" | "alarm" }[] = [
      { label: o.vfd ? `Slowing the pump · ${f0(o.hz)} Hz` : `Choking the valve · ${f0(o.valvePct)}%`, state: "ok" },
      { label: o.manual ? "Drive in Hand · P8" : "Drive auto · P16", state: o.manual ? "overridden" : "ok" },
    ];
    if (o.short) chips.push({ label: "Short of flow", state: "alarm" });
    if (o.reversed) chips.push({ label: "Motor wired backwards", state: "fault" });
    if (o.clog > 0) chips.push({ label: `Strainer ${f0(o.clog * 100)}% clogged`, state: "fault" });
    return chips;
  },

  describe: (o) =>
    `A chilled-water pump on a closed loop, ${o.vfd ? "slowed by its drive" : "throttled by its triple-duty valve"}. ` +
    `It moves ${f0(o.q)} gpm of the ${f0(o.flowSp)} wanted at ${f0(o.hz)} Hz against ${f0(o.head)} ft of head, drawing ${f2(o.kw)} kW; ` +
    `the valve is ${f0(o.valvePct)} % open and burns ${f0(o.hValve)} ft.`,

  legend: (o) => [{ label: "CHW", tempF: o.chwTemp }],
};
