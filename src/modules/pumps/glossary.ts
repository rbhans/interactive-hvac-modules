/** Plain-language definitions for the explainer's <Term> tooltips. */
export const glossary: Record<string, { term: string; def: string }> = {
  pump: {
    term: "Centrifugal pump",
    def: "A spinning impeller flings water outward into the casing, which turns that speed into pressure. Nearly every pump in a building is one.",
  },
  impeller: {
    term: "Impeller",
    def: "The wheel of curved vanes inside the pump. Water comes in at its center (the eye) and leaves at its rim.",
  },
  gpm: {
    term: "gpm",
    def: "Gallons per minute: how much water is moving.",
  },
  head: {
    term: "Head",
    def: "Pressure, measured as how high a column of water it could hold up, in feet. About 2.3 ft per psi. Pumps and pipes are rated in head because it doesn't depend on the liquid.",
  },
  pumpcurve: {
    term: "Pump curve",
    def: "How much head the pump makes at each flow: the most when nothing flows, falling off as flow rises.",
  },
  systemcurve: {
    term: "System curve",
    def: "How much head the piping, coils and valves take at each flow. In a closed loop it grows with the square of the flow: twice the water, four times the pressure.",
  },
  operating: {
    term: "Operating point",
    def: "Where the pump curve crosses the system curve: the only flow and head the pump can run at, for that speed and that system.",
  },
  vfd: {
    term: "VFD",
    def: "Variable frequency drive: sets the motor's speed by changing the frequency of its power. 60 Hz is full speed.",
  },
  affinity: {
    term: "Affinity laws",
    def: "How a pump changes with speed: flow goes with speed, head with speed squared, power with speed cubed. Three-quarters speed: three-quarters the flow, a bit over half the head, about 40 % of the power.",
  },
  tdv: {
    term: "Triple-duty valve",
    def: "One valve on the pump's discharge that does three jobs: shutoff, check (no backflow) and balancing. Turning it in adds resistance to set the flow.",
  },
  balancing: {
    term: "Balancing",
    def: "Setting each pump and branch to its design flow, usually by a test-and-balance contractor with a flow meter and the valves.",
  },
  bep: {
    term: "Best efficiency point",
    def: "The flow where the pump turns the most of its power into moving water. It slides down with the speed, so a slowed pump stays near it.",
  },
  strainer: {
    term: "Strainer",
    def: "A screen on the pump's suction that catches debris before it reaches the impeller. As it fills, it takes more and more head.",
  },
  hand: {
    term: "Hand",
    def: "A drive's local manual mode: it runs at the speed set on its keypad and ignores the control system.",
  },
};
