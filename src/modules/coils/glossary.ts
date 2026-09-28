/** Plain-language definitions for the explainer's <Term> tooltips. */
export const glossary: Record<string, { term: string; def: string }> = {
  ahu: {
    term: "Air handler (AHU)",
    def: "The big box that moves air through a building: fans, filters, heating and cooling coils, and dampers.",
  },
  coil: {
    term: "Coil",
    def: "A radiator for air: rows of tubes carrying water, threaded through thousands of thin aluminum fins. Air passing through the fins trades heat with the water.",
  },
  chw: {
    term: "Chilled water",
    def: "Water cooled to around 42–45 °F by a chiller and pumped to the building's cooling coils.",
  },
  hw: {
    term: "Hot water",
    def: "Water heated by a boiler, often to 140–180 °F, and pumped to heating coils.",
  },
  valve: {
    term: "Control valve",
    def: "A valve a motor can position anywhere from shut to wide open, so the control system can meter how much water goes through the coil.",
  },
  actuator: {
    term: "Actuator",
    def: "The motor on top of the valve. It pushes the stem up and down when the control system tells it to, and reports where it is.",
  },
  stem: {
    term: "Stem",
    def: "The rod that lifts the valve's plug off its seat. How far it's lifted sets how much water gets through.",
  },
  dt: {
    term: "ΔT (delta-T)",
    def: "How much the water's temperature changes going through the coil. A healthy chilled-water coil warms its water by about 10–15 °F.",
  },
  capacity: {
    term: "Capacity",
    def: "How much heat the coil is moving: how much it's heating or cooling the air, right now.",
  },
  equal: {
    term: "Equal-percentage valve",
    def: "A valve shaped to open slowly at first and faster later. Each bit of extra travel adds the same percentage of flow on top of what's already flowing.",
  },
  authority: {
    term: "Valve authority",
    def: "How much of the circuit's pressure drop the valve itself takes up. An oversized valve has low authority: the pipe and coil around it take over, and it does most of its work early in its travel.",
  },
  leak: {
    term: "Leak-by",
    def: "Water getting past a valve that's supposed to be shut, usually from a worn seat or an actuator that can't quite close it.",
  },
  condensate: {
    term: "Condensate",
    def: "Water that condenses out of humid air onto a cold coil, the same way a cold drink sweats. It drips into a drain pan.",
  },
  dat: {
    term: "Discharge air",
    def: "The air leaving the air handler, after the coils. Its temperature is what the loop controls.",
  },
  loop: {
    term: "Control loop",
    def: "Logic that keeps nudging the valve open or closed until the discharge air matches its target.",
  },
  hunting: {
    term: "Hunting",
    def: "A loop that can't settle: it overshoots one way, then the other, over and over.",
  },
  plant: {
    term: "Plant",
    def: "The chillers, boilers and pumps that make the building's chilled and hot water.",
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
    def: "What the control system tells a device to do, such as open the valve to 40 %.",
  },
  feedback: {
    term: "Feedback",
    def: "What the device reports back. For a valve, it comes from the actuator's own position, not from the water.",
  },
  lowdt: {
    term: "Low ΔT syndrome",
    def: "When coils take more water than they need, the water comes back to the plant barely changed. The plant has to pump more water, and often run more chillers, to deliver the same cooling.",
  },
  priority: {
    term: "Command priority",
    def: "Several things can command the same valve. The lowest priority number wins: a person at 8 beats the program at 16.",
  },
};
