import type { ControlSection } from "@/lab/types";
import type { PumpInputs, PumpOutputs } from "./model";
import { PumpCurves } from "./PumpCurves";

type I = PumpInputs;
type O = PumpOutputs;

export const controls: ControlSection<I, O>[] = [
  // ── bench ─────────────────────────────────────────────────────────────────────
  {
    id: "curves",
    title: "Pump curve × system curve",
    description: "Where the pump runs, and what the other way of getting the same flow would cost.",
    slot: "bench",
    controls: [
      {
        kind: "custom",
        id: "pump-curves",
        label: "Pump and system curves",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Component: PumpCurves as any,
      },
    ],
  },
  {
    id: "points",
    title: "Readings",
    description: "What the control system reads, next to what's really happening.",
    slot: "bench",
    controls: [
      {
        kind: "readout",
        id: "flow",
        point: "CHWP-1/FLOW",
        label: "Flow",
        unit: "gpm",
        value: (o) => o.qMeter,
        status: (o) => (o.short ? "alarm" : "ok"),
        pair: { label: "SP", value: (o) => o.flowSp },
      },
      {
        kind: "readout",
        id: "speed",
        point: "CHWP-1/SPD",
        label: "Drive speed",
        unit: "Hz",
        digits: 1,
        value: (o) => o.hz,
        status: (o) => (o.manual ? "overridden" : "ok"),
        pair: { label: "CMD", value: (o) => (o.speedCmd / 100) * 60 },
      },
      {
        kind: "readout",
        id: "kw",
        point: "CHWP-1/KW",
        label: "Drive power",
        unit: "kW",
        digits: 2,
        value: (o) => o.kw,
      },
      {
        kind: "readout",
        id: "dp",
        point: "CHWP-1/DP",
        label: "Pressure across the pump",
        unit: "psi",
        digits: 1,
        value: (o) => o.discharge - o.suction,
        status: (o) => (o.reversed ? "fault" : "ok"),
      },
      {
        kind: "readout",
        id: "burned",
        point: "triple-duty valve",
        label: "Head the valve burns",
        unit: "ft",
        digits: 1,
        reality: true,
        value: (o) => o.hValve,
      },
      {
        kind: "readout",
        id: "eff",
        point: "pump",
        label: "Pump efficiency",
        unit: "%",
        reality: true,
        value: (o) => o.eff * 100,
      },
      {
        kind: "readout",
        id: "strainer",
        point: "strainer",
        label: "Head lost in the strainer",
        unit: "ft",
        digits: 1,
        reality: true,
        value: (o) => o.hStrainer,
      },
    ],
  },
  {
    id: "trend",
    title: "Trend",
    description: "The last 90 seconds of power, flow, speed and the valve.",
    slot: "bench",
    controls: [
      {
        kind: "trend",
        id: "pump-trend",
        label: "Power and flow",
        window: 90,
        left: { tick: "", step: 2, minSpan: 4, digits: 2, floor: 0 },
        pens: [
          { id: "kw", label: "Power", unit: " kW", axis: "temp", color: "#f3eee4", value: (o) => o.kw },
          { id: "flow", label: "Flow", unit: "%", axis: "pct", color: "#27b7ff", value: (o) => o.flowPct },
          { id: "speed", label: "Speed", unit: "%", axis: "pct", color: "#ff5a1f", value: (o) => o.speedPct },
          { id: "valve", label: "Valve", unit: "%", axis: "pct", color: "#7f7c75", dashed: true, value: (o) => o.valvePct },
        ],
      },
    ],
  },

  // ── side rack ─────────────────────────────────────────────────────────────────
  {
    id: "method",
    title: "Getting less water",
    description: "The building needs less than the pump makes on its own. Slow the pump down, or choke it with a valve.",
    slot: "side",
    controls: [
      {
        kind: "segmented",
        id: "method",
        label: "How",
        options: [
          { value: "vfd", label: "Slow the pump" },
          { value: "valve", label: "Choke the valve" },
        ],
        hint: "Choking is how it's often done at startup: a balancer turns the triple-duty valve in until the meter reads right. Here a loop does it for them.",
        get: (i) => i.method,
        set: (i, v) => ({ ...i, method: v as I["method"] }),
      },
      {
        kind: "slider",
        id: "flow-sp",
        label: "Flow the building needs",
        unit: "gpm",
        min: 150,
        max: 460,
        step: 10,
        marks: () => [{ label: "design", value: 400 }],
        get: (i) => i.flowSp,
        set: (i, v) => ({ ...i, flowSp: v }),
      },
    ],
  },
  {
    id: "pump",
    title: "Pump",
    description: "Picked for 400 gpm at 70 ft, or one size up to be safe.",
    slot: "side",
    controls: [
      {
        kind: "segmented",
        id: "size",
        label: "Pump",
        options: [
          { value: "right", label: "Right size" },
          { value: "oversized", label: "Oversized" },
        ],
        get: (i) => i.size,
        set: (i, v) => ({ ...i, size: v as I["size"] }),
      },
      {
        kind: "override",
        id: "override",
        label: "Drive speed",
        point: "CHWP-1/SPD-CMD",
        unit: "%",
        min: 0,
        max: 100,
        step: 1,
        get: (i) => i.override,
        set: (i, v) => ({ ...i, override: v }),
        programValue: (o) => (o.vfd ? o.loopOut : 100),
        programPriority: 16,
        activePriority: (o) => o.activePriority,
      },
    ],
  },
  {
    id: "service",
    title: "Service",
    description: "Break things on purpose.",
    slot: "side",
    controls: [
      {
        kind: "faults",
        id: "faults",
        label: "Fault injector",
        active: (i) => (i.faults.reversed ? 1 : 0) + (i.faults.clog > 0 ? 1 : 0),
        items: [
          {
            kind: "toggle",
            id: "reversed",
            label: "Motor wired backwards",
            hint: "Two leads crossed after a motor swap: the impeller spins the wrong way. It still pumps, a lot less.",
            get: (i) => i.faults.reversed,
            set: (i, on) => ({ ...i, faults: { ...i.faults, reversed: on } }),
          },
          {
            kind: "slider",
            id: "clog",
            label: "Suction strainer clogging",
            hint: "Debris loading the strainer's screen: more head lost before the water reaches the pump.",
            unit: "%",
            min: 0,
            max: 100,
            step: 5,
            get: (i) => Math.round(i.faults.clog * 100),
            set: (i, v) => ({ ...i, faults: { ...i.faults, clog: v / 100 } }),
          },
        ],
      },
    ],
  },
];
