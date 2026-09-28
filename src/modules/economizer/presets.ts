import type { Preset } from "@/lab/types";
import { DEFAULT_INPUTS, type EconInputs, type EconState } from "./model";

const base = DEFAULT_INPUTS;

export const presets: Preset<EconInputs, EconState>[] = [
  {
    id: "mild-day",
    label: "Mild day",
    cue: "Cool outside, so outside air cools for free. The damper settles near 62 % open while about 71 % of the air is from outside. Now look at the low end of the curve.",
    inputs: { ...base, oat: 48 },
    seed: { actuatorPos: base.minOaPos },
  },
  {
    id: "hot-day",
    label: "Hot day",
    cue: "Too warm outside to help, so free cooling shuts off and the damper drops to its minimum: 20 % open, which on this box is under 8 % outside air.",
    inputs: { ...base, oat: 88, rat: 75 },
    seed: { actuatorPos: 70, loopOut: 70, integral: 70, econEnabled: true },
  },
  {
    id: "cold-day",
    label: "Cold day",
    cue: "Freezing outside, so only a little outside air is wanted. This minimum was set by measurement (32 % open for about 20 % outside air), and the damper trims just above it.",
    inputs: { ...base, oat: 0, minOaPos: 32 },
    seed: { actuatorPos: 45 },
  },
  {
    id: "override",
    label: "Override left on",
    cue: "Someone set the damper to 100 % by hand and forgot. The program asks for minimum, but a person outranks it (P8 beats P16), so the mixed air sits 10 °F below target.",
    breakIt: true,
    inputs: { ...base, oat: 45, override: { mode: "manual", value: 100 } },
    seed: { actuatorPos: 100 },
  },
  {
    id: "stuck",
    label: "Stuck damper",
    cue: "The screen says the damper is 100 % open, and its feedback agrees. The blades are really at 8 %, so the mixed air never cools down.",
    breakIt: true,
    inputs: { ...base, oat: 45, faults: { stuckDamper: true, stuckAt: 8, matOffset: 0 } },
    seed: { actuatorPos: 30 },
  },
  {
    id: "hunting",
    label: "Gain too high",
    cue: "The loop's gain is cranked up, so every correction overshoots. The damper swings back and forth and never settles. This is called hunting.",
    breakIt: true,
    inputs: { ...base, oat: 48, kp: 16 },
    seed: { actuatorPos: base.minOaPos },
  },
];
