import type { Preset } from "@/lab/types";
import { DEFAULT_INPUTS, positionFor, type VavInputs, type VavState } from "./model";

const base = DEFAULT_INPUTS;

/** An old pressure-dependent box starts with its thermostat loop holding the damper where it was */
const holding = (pos: number): Partial<VavState> => ({ act: pos, blade: pos, zoneOut: pos, zoneI: pos, flowI: pos, loopOut: pos });

export const presets: Preset<VavInputs, VavState>[] = [
  {
    id: "steady",
    label: "Steady office",
    cue: "The room needs about 390 cfm. The flow loop holds it with the damper about 40 % open, and burns about 1 in. of the duct's pressure doing it.",
    inputs: { ...base },
  },
  {
    id: "swings",
    label: "Duct pressure swings",
    cue: "Boxes down the hall keep opening and closing, so the duct pressure here swings ±0.35 in. This box measures its airflow and chases it, so the airflow only wobbles about 4 %.",
    inputs: { ...base, staticSwing: 0.35 },
  },
  {
    id: "dependent",
    label: "Old pressure-dependent box",
    cue: "Same swings, but this box has no airflow sensor: the thermostat sets the damper position directly. Every pressure swing becomes an airflow swing of about ±27 %.",
    breakIt: true,
    inputs: { ...base, control: "dependent", staticSwing: 0.35 },
    seed: holding(positionFor(390, 1.0) * 100),
  },
  {
    id: "starved",
    label: "Starved box",
    cue: "Only 0.18 in. of duct pressure reaches this box. The damper is wide open and the room still drifts warm, because the box can't get the airflow it's calling for. A box stuck wide open is asking the fan for more pressure.",
    breakIt: true,
    inputs: { ...base, staticIn: 0.18, load: 17000 },
  },
  {
    id: "drift",
    label: "Drifted sensor at minimum",
    cue: "The box reads 150 cfm, its minimum, but really moves about 100. At minimum the flow signal is only about 0.01 in. of water, so a transducer drifted by 0.006 in. is off by a third. That minimum is the room's fresh air.",
    breakIt: true,
    inputs: { ...base, load: 2000, faults: { ...base.faults, vpOffset: 0.006 } },
  },
  {
    id: "high-static",
    label: "Too much static",
    cue: "2.5 in. of duct pressure behind a box that only needs a few tenths. It still holds its airflow, but the damper sits under 20 % open, burning over 2.4 in. of pressure the fan paid for, and a real box would whistle.",
    breakIt: true,
    inputs: { ...base, staticIn: 2.5, load: 3500 },
  },
];
