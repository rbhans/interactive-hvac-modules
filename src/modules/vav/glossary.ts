/** Plain-language definitions for the explainer's <Term> tooltips. */
export const glossary: Record<string, { term: string; def: string }> = {
  ahu: {
    term: "Air handler (AHU)",
    def: "The big box that makes the building's cool supply air and pushes it into the ductwork with a fan.",
  },
  vav: {
    term: "VAV box",
    def: "Variable air volume box: a small box in the ceiling, one per room or zone, that meters how much cool air the room gets.",
  },
  static: {
    term: "Duct static pressure",
    def: "How hard the supply fan is pushing on the air in the duct, in inches of water. It's what drives air through each box.",
  },
  inwc: {
    term: "Inches of water",
    def: "A unit of pressure: how high it would push a column of water. Ductwork runs at about 0.5 to 2 in.",
  },
  cfm: {
    term: "cfm",
    def: "Cubic feet per minute: how much air is moving. An office might need a few hundred.",
  },
  damper: {
    term: "Damper",
    def: "The blade inside the box that opens and closes to let more or less air through.",
  },
  actuator: {
    term: "Actuator",
    def: "The motor that turns the damper when the controller tells it to, and reports where it is.",
  },
  flowcross: {
    term: "Flow sensor (flow cross)",
    def: "Tubes across the box's inlet that pick up the air's velocity pressure, so the controller can work out the airflow.",
  },
  vp: {
    term: "Velocity pressure",
    def: "The pressure moving air carries because it's moving. It grows with the square of the speed: twice the airflow, four times the pressure.",
  },
  transducer: {
    term: "Transducer",
    def: "The small sensor in the controller that turns the flow cross's tiny pressure into a number.",
  },
  independent: {
    term: "Pressure-independent",
    def: "A box that measures its airflow and adjusts its damper to hold it, whatever the duct pressure does.",
  },
  dependent: {
    term: "Pressure-dependent",
    def: "An older kind of box with no airflow sensor: the thermostat sets the damper position directly, so the airflow changes whenever the duct pressure does.",
  },
  setpoint: {
    term: "Setpoint",
    def: "The target the control system tries to hold, like the number on a thermostat.",
  },
  minflow: {
    term: "Minimum airflow",
    def: "The least air the box may deliver, even when the room is cool enough. It's there mostly for fresh air: part of every cfm is outside air.",
  },
  loop: {
    term: "Control loop",
    def: "Logic that keeps nudging something (here, the damper) until a reading matches its target.",
  },
  cascade: {
    term: "Two loops",
    def: "The room loop decides how much air the room needs; the airflow loop moves the damper to deliver it.",
  },
  starved: {
    term: "Starved",
    def: "A box that's wide open and still can't get the airflow it wants, because there isn't enough duct pressure behind it.",
  },
  reset: {
    term: "Static pressure reset",
    def: "Lowering the duct pressure until the neediest box is just barely satisfied, instead of running it high all the time. It saves fan energy and quiets the boxes.",
  },
  bas: {
    term: "Control system (BAS)",
    def: "The building automation system: the computer that runs the equipment and shows it to operators on graphics like this one.",
  },
  priority: {
    term: "Command priority",
    def: "Several things can command the same damper. The lowest priority number wins: a person at 8 beats the program at 16.",
  },
};
