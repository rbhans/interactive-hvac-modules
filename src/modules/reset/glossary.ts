/** Plain-language definitions for the explainer's <Term> tooltips. */
export const glossary: Record<string, { term: string; def: string }> = {
  ahu: {
    term: "Air handler (AHU)",
    def: "The big box that makes the building's cool supply air and pushes it into the ductwork with a fan.",
  },
  vfd: {
    term: "VFD",
    def: "Variable frequency drive: the box on the wall that sets the fan motor's speed by changing the frequency of its power, in hertz. 60 Hz is full speed.",
  },
  vav: {
    term: "VAV box",
    def: "Variable air volume box: a small box in the ceiling, one per room or zone, that meters how much cool air the zone gets.",
  },
  zone: {
    term: "Zone",
    def: "A room or group of rooms that one thermostat and one VAV box look after.",
  },
  static: {
    term: "Duct static pressure",
    def: "How hard the supply fan is pushing on the air in the duct, in inches of water. It's what drives air through each box.",
  },
  inwc: {
    term: "Inches of water",
    def: "A unit of pressure: how high it would push a column of water. Ductwork runs at about 0.1 to 2 in.",
  },
  sensor: {
    term: "Static pressure sensor",
    def: "A probe in the supply duct and a transducer that turns the pressure there into a signal. The fan's speed loop holds this one reading at its setpoint.",
  },
  cfm: {
    term: "cfm",
    def: "Cubic feet per minute: how much air is moving.",
  },
  damper: {
    term: "Damper",
    def: "The blade inside a VAV box that opens and closes to let more or less air through.",
  },
  setpoint: {
    term: "Setpoint",
    def: "The value a control loop is trying to hold. Here, the duct static pressure the fan aims for.",
  },
  reset: {
    term: "Static pressure reset",
    def: "Moving the duct static setpoint up and down with what the boxes need, instead of holding one fixed number.",
  },
  tr: {
    term: "Trim & respond",
    def: "A reset method: every few minutes, nudge the setpoint down a little (trim) unless enough boxes are asking for more, then raise it (respond) in proportion to how many are.",
  },
  request: {
    term: "Request",
    def: "A box telling the air handler it needs more pressure. A box sends 1 when its damper is almost wide open, 2 or 3 when it's wide open and still short of air.",
  },
  ignores: {
    term: "Ignored requests",
    def: "How many requests trim & respond lets go by before it responds, so one fussy box doesn't run the whole system. Sized for how many boxes the system has.",
  },
  importance: {
    term: "Importance multiplier",
    def: "A number each zone's requests are multiplied by: 0 ignores the zone entirely, 1 counts it normally, more makes a critical space count extra.",
  },
  rogue: {
    term: "Rogue zone",
    def: "A zone that asks for more all the time, because it's broken or can't be satisfied, and so holds the whole system's pressure at the top.",
  },
  critical: {
    term: "Critical zone",
    def: "Whichever box needs the most pressure right now. It sets the static for everyone, and it changes through the day.",
  },
  g36: {
    term: "ASHRAE Guideline 36",
    def: "A published set of standard, tested control sequences for HVAC systems. Its trim & respond static pressure reset is what this module runs.",
  },
  kw: {
    term: "kW",
    def: "Kilowatts: the electrical power the fan is drawing right now.",
  },
};
