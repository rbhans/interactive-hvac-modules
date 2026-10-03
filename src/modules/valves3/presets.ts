import type { Preset } from "@/lab/types";
import { DEFAULT_INPUTS, type ValveInputs, type ValveState } from "./model";

const base = DEFAULT_INPUTS;
const all = (k: "three" | "two") => [k, k, k];

export const presets: Preset<ValveInputs, ValveState>[] = [
  {
    id: "three",
    label: "Three-way valves",
    cue: "Two-thirds load. Each coil takes only the water it needs and its valve sends the rest around through the bypass, so the loop still moves 324 gpm and the pump holds 58 Hz: 4.5 kW. The water goes back only 7 °F warmer than it came.",
    inputs: { ...base },
  },
  {
    id: "two",
    label: "Two-way valves",
    cue: "Same load, every bypass shut. Now each valve cuts the flow instead of rerouting it: the loop drops to 122 gpm, the pump slows to 33 Hz and 0.9 kW, and the water goes back 18 °F warmer.",
    inputs: { ...base, kinds: all("two") },
  },
  {
    id: "retrofit",
    label: "Halfway retrofit",
    cue: "The first two coils converted, the last one left three-way: the usual way to keep some water moving at light load. 181 gpm, 41 Hz, 1.6 kW.",
    inputs: { ...base, kinds: ["two", "two", "three"] },
  },
  {
    id: "mild-three",
    label: "Mild day, three-way",
    cue: "A mild morning at 30 % load. The three-way valves still push 324 gpm around the loop, and the water goes back just 3 °F warmer than it left. That's low ΔT; module 07 is about what it does to the chillers.",
    inputs: { ...base, load: 30 },
  },
  {
    id: "mild-two",
    label: "Mild day, all two-way",
    cue: "The same mild morning with every valve two-way. The loop drops to 44 gpm, under the 105 gpm the chiller needs to keep running. Real systems keep a bypass, a three-way valve at the far end, or a separate pump for the chillers (module 07).",
    breakIt: true,
    inputs: { ...base, load: 30, kinds: all("two") },
  },
  {
    id: "bypass",
    label: "Bypass left wide open",
    cue: "Someone opened AHU-1's bypass balancing valve all the way. Its branch now swallows about 140 gpm, the pump runs out of speed at 60 Hz, and the pressure at the far coil sags below its 18 ft setpoint.",
    breakIt: true,
    inputs: { ...base, faults: { bypassOpen: true } },
  },
];
