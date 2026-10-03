import type { ControlSection } from "@/lab/types";
import { LoopPanel } from "./LoopPanel";
import type { ValveInputs, ValveOutputs } from "./model";

type I = ValveInputs;
type O = ValveOutputs;

const kind = (k: number) => ({
  kind: "segmented" as const,
  id: `kind${k + 1}`,
  label: `AHU-${k + 1} valve`,
  options: [
    { value: "three", label: "Three-way" },
    { value: "two", label: "Two-way" },
  ],
  get: (i: I) => i.kinds[k],
  set: (i: I, v: string) => ({ ...i, kinds: i.kinds.map((x, j) => (j === k ? (v as I["kinds"][number]) : x)) }),
});

export const controls: ControlSection<I, O>[] = [
  // ── bench ─────────────────────────────────────────────────────────────────────
  {
    id: "loop",
    title: "Through or around",
    description: "Where each coil's water goes, what the pump has to move, and how warm the water goes back.",
    slot: "bench",
    controls: [
      {
        kind: "custom",
        id: "loop-panel",
        label: "Coil flows",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Component: LoopPanel as any,
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
        id: "dp",
        point: "CHW-DP",
        label: "Pressure across the far coil",
        unit: "ft",
        digits: 1,
        value: (o) => o.dp,
        status: (o) => (o.dp < o.dpSp - 0.8 ? "alarm" : "ok"),
        pair: { label: "SP", value: (o) => o.dpSp },
      },
      {
        kind: "readout",
        id: "speed",
        point: "CHWP-1/SPD",
        label: "Pump speed",
        unit: "Hz",
        digits: 1,
        value: (o) => o.hz,
        status: (o) => (o.manual ? "overridden" : "ok"),
        pair: { label: "CMD", value: (o) => (o.speedCmd / 100) * 60 },
      },
      { kind: "readout", id: "kw", point: "CHWP-1/KW", label: "Pump power", unit: "kW", digits: 2, value: (o) => o.kw },
      {
        kind: "readout",
        id: "flow",
        point: "CHW-F",
        label: "Loop flow",
        unit: "gpm",
        value: (o) => o.total,
        status: (o) => (o.lowFlow ? "alarm" : "ok"),
      },
      { kind: "readout", id: "ret", point: "CHWR-T", label: "Return water", unit: "°F", digits: 1, value: (o) => o.returnT },
      {
        kind: "readout",
        id: "bypassed",
        point: "bypasses",
        label: "Water sent around the coils",
        unit: "gpm",
        reality: true,
        value: (o) => o.bypassQ1 + o.bypassQ2 + o.bypassQ3,
      },
      { kind: "readout", id: "tons", point: "coils", label: "Cooling delivered", unit: "tons", reality: true, value: (o) => o.tons },
    ],
  },
  {
    id: "trend",
    title: "Trend",
    description: "The last 90 seconds of the water temperatures, the flow and the pump.",
    slot: "bench",
    controls: [
      {
        kind: "trend",
        id: "loop-trend",
        label: "Temperatures and flow",
        window: 90,
        pens: [
          { id: "ret", label: "Return", unit: "°", axis: "temp", color: "#f3eee4", value: (o) => o.returnT },
          { id: "sup", label: "Supply", unit: "°", axis: "temp", color: "#7f7c75", dashed: true, value: (o) => o.supplyT },
          { id: "flow", label: "Flow", unit: "%", axis: "pct", color: "#27b7ff", value: (o) => (o.total / 300) * 100 },
          { id: "speed", label: "Pump", unit: "%", axis: "pct", color: "#ff5a1f", value: (o) => o.speedPct },
        ],
      },
    ],
  },

  // ── side rack ─────────────────────────────────────────────────────────────────
  {
    id: "valves",
    title: "Valves",
    description: "A three-way valve sends what its coil doesn't need around it. Shut its bypass and it works as a two-way: it cuts the flow instead.",
    slot: "side",
    controls: [kind(0), kind(1), kind(2)],
  },
  {
    id: "load",
    title: "Cooling load",
    description: "How hard the building's working. Each coil carries its share.",
    slot: "side",
    controls: [
      {
        kind: "slider",
        id: "load",
        label: "Building load",
        unit: "%",
        min: 10,
        max: 100,
        step: 5,
        get: (i) => i.load,
        set: (i, v) => ({ ...i, load: v }),
      },
    ],
  },
  {
    id: "pump",
    title: "Pump",
    description: "The drive holds a set pressure across the far coil, so the last coil always has enough to push water through.",
    slot: "side",
    controls: [
      {
        kind: "setpoint",
        id: "dp-sp",
        label: "Differential pressure setpoint",
        point: "CHW-DP-SP",
        unit: "ft",
        min: 8,
        max: 30,
        step: 1,
        digits: 0,
        get: (i) => i.dpSp,
        set: (i, v) => ({ ...i, dpSp: v }),
      },
      {
        kind: "override",
        id: "override",
        label: "Pump speed",
        point: "CHWP-1/SPD-CMD",
        unit: "%",
        min: 0,
        max: 100,
        step: 1,
        get: (i) => i.override,
        set: (i, v) => ({ ...i, override: v }),
        programValue: (o) => o.pumpLoop,
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
        active: (i) => (i.faults.bypassOpen ? 1 : 0),
        items: [
          {
            kind: "toggle",
            id: "bypass",
            label: "AHU-1 bypass balancing valve wide open",
            hint: "The bypass was balanced to match the coil. Opened all the way, it's the easy road: that branch hogs water whenever its valve sends any around.",
            get: (i) => i.faults.bypassOpen,
            set: (i, on) => ({ ...i, faults: { ...i.faults, bypassOpen: on } }),
          },
        ],
      },
    ],
  },
];
