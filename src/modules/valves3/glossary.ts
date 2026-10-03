/** Plain-language definitions for the explainer's <Term> tooltips. */
export const glossary: Record<string, { term: string; def: string }> = {
  chw: {
    term: "Chilled water",
    def: "Water the chillers cool to about 44 °F and the pumps push to every air handler's cooling coil. It comes back warmer, carrying the heat.",
  },
  coil: {
    term: "Cooling coil",
    def: "Rows of finned tubes in an air handler: chilled water inside, the building's air blowing across, heat moving from the air into the water.",
  },
  threeway: {
    term: "Three-way valve",
    def: "A control valve with three ports. Here it mixes: it takes water from the coil and from a bypass around the coil, in whatever split the coil's loop asks for. The total through it barely changes.",
  },
  twoway: {
    term: "Two-way valve",
    def: "A control valve with one way in and one way out. Closing it cuts the flow.",
  },
  bypass: {
    term: "Bypass",
    def: "A pipe around a coil, from its supply to its return. On a three-way valve it carries whatever water the coil isn't using, still cold.",
  },
  balancing: {
    term: "Balancing valve",
    def: "A manual valve set once to make a pipe carry its design flow. On a bypass, set to match the coil, so the branch flows the same whichever way the water goes.",
  },
  dp: {
    term: "Differential pressure",
    def: "The pressure difference between the supply and return pipes, here across the farthest coil. The pump's drive holds it at a setpoint, so the last coil always has enough push.",
  },
  deltat: {
    term: "ΔT",
    def: "Delta-T: how much warmer the water comes back than it went out. A chiller plant is designed for a certain ΔT, about 12 °F here; less means it's pumping more water for the same cooling.",
  },
  minflow: {
    term: "Minimum flow",
    def: "The least water a chiller can have through it and keep running safely. Below it the chiller trips off, or freezes its tubes.",
  },
  vfd: {
    term: "VFD",
    def: "Variable frequency drive: sets the pump motor's speed. 60 Hz is full speed.",
  },
};
