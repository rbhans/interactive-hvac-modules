/** Plain-language definitions for the explainer's <Term> tooltips. */
export const glossary: Record<string, { term: string; def: string }> = {
  economizer: {
    term: "Economizer",
    def: "The part of an air handler that decides how much fresh outside air to bring in. When it's cool outside, outside air cools the building for free.",
  },
  ahu: {
    term: "Air handler (AHU)",
    def: "The big box that moves air through a building: fans, filters, heating and cooling coils, and the dampers that mix outside and return air.",
  },
  damper: {
    term: "Damper",
    def: "A set of blades in a duct that rotate like window blinds to let more or less air through.",
  },
  actuator: {
    term: "Actuator",
    def: "A small motor clamped onto a damper's shaft. It turns the blades when the control system tells it to, and reports back where its own shaft is.",
  },
  oa: {
    term: "Outside air (OA)",
    def: "Fresh air pulled in from outdoors, for ventilation and, when it's cool, for free cooling.",
  },
  ra: {
    term: "Return air (RA)",
    def: "Air coming back from the rooms to be reused. It's already close to room temperature.",
  },
  mat: {
    term: "Mixed air (MAT)",
    def: "Outside and return air blended together, just before it's filtered, heated or cooled. MAT is its temperature.",
  },
  relief: {
    term: "Relief",
    def: "An exit for extra air. Bringing outside air in means pushing about the same amount out, or the building over-pressurizes and doors whistle.",
  },
  bas: {
    term: "Control system (BAS)",
    def: "The building automation system: the computer that runs the equipment and shows it to operators on graphics like this one.",
  },
  setpoint: {
    term: "Setpoint",
    def: "The target the control system tries to hold, like the number on a thermostat.",
  },
  command: {
    term: "Command",
    def: "What the control system tells a device to do, such as open the damper to 60 %.",
  },
  feedback: {
    term: "Feedback",
    def: "What the device reports back. For a damper, it usually comes from the actuator's own shaft, not the blades.",
  },
  loop: {
    term: "Control loop",
    def: "Logic that keeps nudging the damper open or closed until the measured temperature matches the setpoint.",
  },
  gain: {
    term: "Gain",
    def: "How hard the loop reacts to being off target. Too little and it's sluggish. Too much and it overshoots back and forth, which is called hunting.",
  },
  authority: {
    term: "Authority",
    def: "How much of an air path's total resistance is the damper itself. With low authority, most of the blade travel barely changes the airflow.",
  },
  minoa: {
    term: "Minimum outside air",
    def: "The least fresh air the building must always get, for the people inside and the space itself. Codes set it in cubic feet per minute, not damper position.",
  },
  highlimit: {
    term: "High limit",
    def: "The outdoor temperature above which outside air is too warm to help. Above it, free cooling shuts off and the damper drops to minimum.",
  },
  priority: {
    term: "Command priority",
    def: "Several things can command the same damper. Each command has a priority number, and the lowest number wins: a safety at 5 beats a person at 8, who beats the normal program at 16.",
  },
  override: {
    term: "Manual override",
    def: "A person taking control of a point by hand. It stays in place until someone releases it, which is easy to forget.",
  },
  freeze: {
    term: "Freeze protection",
    def: "A safety that shuts outside air off if the mixed air gets near freezing, before water in a coil can freeze and split a tube.",
  },
  offset: {
    term: "Sensor error",
    def: "A sensor that reads consistently high or low. The control system believes it and controls to the wrong temperature.",
  },
};
