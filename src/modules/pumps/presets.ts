import type { Preset } from "@/lab/types";
import { DEFAULT_INPUTS, type PumpInputs, type PumpState } from "./model";

const base = DEFAULT_INPUTS;

export const presets: Preset<PumpInputs, PumpState>[] = [
  {
    id: "slowed",
    label: "Slow the pump",
    cue: "The building needs 300 gpm, three quarters of design. The drive slows the pump to 45 Hz with the valve wide open: 3.1 kW. Watch the pump's curve drop to meet the pipes'.",
    inputs: { ...base },
  },
  {
    id: "throttled",
    label: "Choke the valve",
    cue: "Same 300 gpm, the old way: the pump stays at 60 Hz and the triple-duty valve closes to about 60 %. The pump rides up its curve, the valve burns 42 ft of head, and it takes 6.8 kW, more than twice as much.",
    inputs: { ...base, method: "valve" },
  },
  {
    id: "oversized",
    label: "Oversized, balanced shut",
    cue: "One size up to be safe. Wide open it would push 460 gpm, so the balancer closed the triple-duty valve to 71 % to get 400. The valve burns 35 ft and the pump draws 10.8 kW. Switch to Slow the pump: 52 Hz, 7.3 kW, the same 400 gpm.",
    breakIt: true,
    inputs: { ...base, method: "valve", size: "oversized", flowSp: 400 },
  },
  {
    id: "hand",
    label: "Drive left in Hand",
    cue: "Someone put the drive in Hand at 60 Hz on a service call and never put it back. The building wants 300 gpm and gets 400, and the pump draws 7.4 kW instead of 3.1. Nothing alarms: too much water never complains.",
    breakIt: true,
    inputs: { ...base, override: { mode: "manual", value: 100 } },
  },
  {
    id: "backwards",
    label: "Wired backwards",
    cue: "After a motor swap, two leads got crossed and the impeller spins backwards. A centrifugal pump still pumps that way, badly: the drive runs up to 60 Hz and only gets 255 gpm against 28 ft, where it should make 400 against 70.",
    breakIt: true,
    inputs: { ...base, flowSp: 400, faults: { ...base.faults, reversed: true } },
  },
  {
    id: "strainer",
    label: "Clogged strainer",
    cue: "The suction strainer is loading up. The drive is at 60 Hz and the flow stops at 352 gpm. The suction gauge reads 12 psi instead of 21: the strainer eats 23 ft before the water even reaches the pump.",
    breakIt: true,
    inputs: { ...base, flowSp: 400, faults: { ...base.faults, clog: 0.8 } },
  },
];
