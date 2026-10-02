import type { Preset } from "@/lab/types";
import { DEFAULT_INPUTS, init, type ResetInputs, type ResetState } from "./model";

const base = DEFAULT_INPUTS;

/** Where a normal day settles with trim & respond: the starting point for the presets that change something */
const normal = init(base);

const withZone = (k: number, load: number): ResetInputs => ({
  ...base,
  zones: base.zones.map((z, j) => (j === k ? { ...z, load } : z)),
});

export const presets: Preset<ResetInputs, ResetState>[] = [
  {
    id: "fixed",
    label: "Fixed setpoint",
    cue: "The fan holds 1.5 in. all day, the number picked for the hottest afternoon. Today every box is throttling, 38 to 58 % open, and the fan runs at 40 Hz. Switch the setpoint to Trim & respond and watch it walk down.",
    inputs: { ...base, mode: "fixed" },
  },
  {
    id: "reset",
    label: "Trim & respond",
    cue: "Every 10 s the setpoint trims down until the corner office's damper passes 95 % and asks for more. It saws between about 0.3 and 0.5 in., the fan turns about 27 Hz, and fan power is about 60 % lower than at a fixed 1.5 in.",
    inputs: { ...base },
  },
  {
    id: "meeting",
    label: "Meeting starts",
    cue: "Twenty people walk into the conference room. Its damper opens past 95 %, it starts asking, and it takes over from the corner office as the box that sets the pressure. The setpoint settles about a tenth of an inch higher.",
    inputs: withZone(2, 18000),
    seed: normal,
  },
  {
    id: "rogue",
    label: "Rogue zone",
    cue: "The Offices damper linkage slipped at 25 %. The actuator drives wide open, the airflow never comes, and the box sends 3 requests forever. Trim & respond climbs to 1.5 in. and stays: all the savings gone, and the room still hot. Tap ×1 under Offices in the panel to ignore it.",
    breakIt: true,
    inputs: { ...base, faults: { ...base.faults, slipped: true } },
    seed: normal,
  },
  {
    id: "ignores",
    label: "Ignoring too many",
    cue: "Guideline 36's example ignores 2 requests, sized for a floor with dozens of boxes. With four, the corner office can send 2 requests, running short of air, and still be ignored. The fan saves more, and the corner office drifts to about 79 °F.",
    breakIt: true,
    inputs: { ...base, ignores: 2 },
    seed: normal,
  },
  {
    id: "crushed",
    label: "Crushed flex",
    cue: "Someone stepped on the corner office's flex duct above the ceiling. That box now needs more pressure to get the same air, and since it's the one setting the pressure, the whole system pays: the setpoint settles near 0.7 in. and fan power rises by about half.",
    breakIt: true,
    inputs: { ...base, faults: { ...base.faults, crushed: true } },
    seed: normal,
  },
];
