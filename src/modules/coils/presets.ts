import type { Preset } from "@/lab/types";
import { DEFAULT_INPUTS, type CoilInputs, type CoilState } from "./model";

const base = DEFAULT_INPUTS;

export const presets: Preset<CoilInputs, CoilState>[] = [
  {
    id: "warm-afternoon",
    label: "Warm afternoon",
    cue: "The cooling valve settles with a bit over half its water flowing, and the coil is already doing about 85 % of all it can.",
    // dry enough that the coil stays dry: the model counts sensible cooling only, so the quoted numbers hold
    inputs: { ...base, mode: "cooling", eat: 70, rh: 40 },
    seed: { act: { chw: 30, hw: 0 } },
  },
  {
    id: "cold-morning",
    label: "Cold morning",
    cue: "Under a third of the hot water is flowing, and it's already doing about two-thirds of the heating the coil can do.",
    inputs: { ...base, mode: "heating", eat: 45 },
    seed: { act: { chw: 0, hw: 20 } },
  },
  {
    id: "wide-open",
    label: "Wide open, barely better",
    cue: "Someone opened the cooling valve all the way. Water flow rises by three-quarters, cooling rises by less than a fifth, and the water warms only 9 °F through the coil instead of 13.",
    breakIt: true,
    inputs: { ...base, mode: "cooling", eat: 70, rh: 40, override: { mode: "manual", value: 100 } },
    seed: { act: { chw: 77, hw: 0 } },
  },
  {
    id: "oversized",
    label: "Oversized valve",
    cue: "This heating valve is too big. The first tenth of its stroke does two-thirds of the heating, so the loop can't settle and the air swings warm and cool.",
    breakIt: true,
    inputs: { ...base, mode: "heating", eat: 55, valveSize: "oversized", valveChar: "linear" },
    seed: { act: { chw: 0, hw: 10 } },
  },
  {
    id: "leaking",
    label: "Leaking heating valve",
    cue: "The heating valve reads 0 % but leaks. The heating coil warms the air, and the cooling valve runs wide open to undo it.",
    breakIt: true,
    inputs: { ...base, mode: "cooling", eat: 70, rh: 50, faults: { ...base.faults, hwLeak: 0.08 } },
    seed: { act: { chw: 60, hw: 0 } },
  },
  {
    id: "warm-chw",
    label: "Warm chilled water",
    cue: "The plant is sending 52 °F water. The valve is wide open and the air still can't get down to 55 °F.",
    breakIt: true,
    inputs: { ...base, mode: "cooling", eat: 76, chwEwt: 52 },
    seed: { act: { chw: 70, hw: 0 } },
  },
];
