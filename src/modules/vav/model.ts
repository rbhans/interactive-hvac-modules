/**
 * VAV box model: pure, deterministic, no rendering.
 *
 * A single-duct, cooling-only box on a branch off the supply main. Duct static pressure at the inlet
 * pushes air through the flow sensor, the butterfly damper, then the discharge duct, flex and
 * diffusers into the room.
 *
 * The same three layers as the other modules:
 *   command  — zone loop → airflow setpoint → flow loop → damper command; operator override at P8
 *   feedback — actuator position, the flow transducer's velocity-pressure reading, the thermostat
 *   physical — blade position, true airflow, true room temperature
 *
 * Pressure-independent: the zone loop asks for an airflow and a flow loop moves the damper to get it,
 * whatever the duct pressure does. Pressure-dependent (older boxes): the zone loop drives the damper
 * position directly, so every duct-pressure change is an airflow change.
 */

export type ControlMode = "independent" | "dependent";
export type OverrideMode = "auto" | "manual";

export interface VavInputs {
  control: ControlMode;
  /** Duct static pressure at the box inlet, in. w.c. */
  staticIn: number;
  /** How far the duct pressure swings either side of staticIn as other boxes open and close, in. w.c. */
  staticSwing: number;
  /** Heat gain in the room (people, lights, sun), Btu/h */
  load: number;
  /** Supply air temperature from the air handler, °F */
  sat: number;
  /** Room cooling setpoint, °F */
  zoneSp: number;
  /** Airflow setpoint limits, cfm */
  minFlow: number;
  maxFlow: number;
  /** Flow loop gain (% damper per % of design airflow error) and reset time, s */
  kp: number;
  ti: number;
  /** Operator override on the damper, written at priority 8 */
  override: { mode: OverrideMode; value: number };
  faults: {
    /** Transducer zero drift, in. w.c., added to the velocity-pressure reading */
    vpOffset: number;
    /** Flow-cross gain error (fouled pickup or wrong K factor), fraction: 0.2 = reads 20 % high */
    kError: number;
    /** Blade stuck at stuckAt % while the actuator keeps moving */
    stuck: boolean;
    stuckAt: number;
  };
}

export interface VavState {
  t: number;
  /** Zone loop integral and output, % (0 = minimum airflow, 100 = maximum) */
  zoneI: number;
  zoneOut: number;
  /** Airflow setpoint from the zone loop, cfm */
  flowSp: number;
  /** Flow loop integral and output (damper command it wants), % */
  flowI: number;
  loopOut: number;
  /** Damper command after priority arbitration, % */
  cmd: number;
  activePriority: 8 | 16;
  /** Actuator (feedback) and blade positions, % */
  act: number;
  blade: number;
  /** True airflow, cfm (lagged a little by the duct) */
  q: number;
  /** What the controller's flow reading says, cfm (filtered like a real controller) */
  qBas: number;
  /** Room air, and the thermostat's lagged reading, °F */
  zone: number;
  zoneSensor: number;
  /** Seconds the box has spent wide open and short of airflow (for the static-pressure request) */
  starvedFor: number;
}

// ── the box ─────────────────────────────────────────────────────────────────────

/**
 * A typical 10" box. Pressure drops are at the design (maximum) airflow and scale with flow².
 * Wide open, it needs about 0.35 in. of inlet static to make its full 1000 cfm.
 */
export const BOX = {
  design: 1000,
  /** Inlet area, ft² (10" round) */
  area: Math.PI * (5 / 12) ** 2,
  /** Flow-cross amplification: sensed ΔP ÷ true velocity pressure */
  gain: 2.3,
  /** Damper and casing, wide open, at design flow, in. w.c. */
  dpOpen: 0.1,
  /** Discharge duct, flex and diffusers at design flow, in. w.c. */
  dpDown: 0.25,
  /** Butterfly damper inherent curve: leak + (1 − leak)·x^k */
  leak: 0.02,
  k: 2.5,
  /** Transducer range and noise, in. w.c. */
  span: 1.0,
  noise: 0.0011,
} as const;

/**
 * Time is compressed like the other modules (~7×): a real 90 s floating actuator strokes in 13 s,
 * and the room and thermostat lags are scaled to match.
 */
export const PHYSICS = {
  strokeTime: 13,
  /** Floating actuators only move once the command is this far (%) from where they are */
  deadband: 0.6,
  backlash: 0.5,
  /** Duct lag on airflow, s */
  flowTau: 0.25,
  /** Controller filter on the flow reading, s */
  readTau: 0.6,
  /** Room time constant at 400 cfm, s (a room has a lot of mass: furniture, slab, walls) */
  zoneTau: 90,
  sensorTau: 3,
  /** Zone loop: % of the airflow range per °F (an 8 °F proportional band, as zone loops usually are), reset time, s */
  zoneKp: 12,
  zoneTi: 90,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Period of the duct-pressure swing, s (compressed time, like everything else) */
export const SWING_PERIOD = 40;

/** Duct static at the inlet at time t: the set value, swinging as the neighbors open and close */
export function staticAt(i: VavInputs, t: number) {
  return Math.max(0.02, i.staticIn + i.staticSwing * Math.sin((2 * Math.PI * t) / SWING_PERIOD));
}

/** Inherent damper curve: flow fraction at constant pressure drop, x in 0–1 */
export function damperInherent(x: number) {
  return BOX.leak + (1 - BOX.leak) * Math.pow(clamp(x, 0, 1), BOX.k);
}

/** True airflow (cfm) with the blade at x (0–1) and staticIn in. w.c. at the inlet */
export function boxFlow(x: number, staticIn: number) {
  const f = damperInherent(x);
  return BOX.design * Math.sqrt(Math.max(0, staticIn) / (BOX.dpOpen / (f * f) + BOX.dpDown));
}

/** Blade position (0–1) that gives airflow q at this inlet static; 1 if even wide open can't */
export function positionFor(q: number, staticIn: number) {
  if (q <= 0) return 0;
  const r = (staticIn * (BOX.design / q) ** 2 - BOX.dpDown) / BOX.dpOpen;
  if (r <= 1) return 1;
  const f = 1 / Math.sqrt(r);
  if (f <= BOX.leak) return 0;
  return clamp(Math.pow((f - BOX.leak) / (1 - BOX.leak), 1 / BOX.k), 0, 1);
}

/** Sensed flow-cross differential (in. w.c.) at airflow q */
export function velocityPressure(q: number) {
  const fpm = Math.max(0, q) / BOX.area;
  return BOX.gain * (fpm / 4005) ** 2;
}

/** The box's K factor: cfm = K·√ΔP */
export const K_FACTOR = BOX.design / Math.sqrt(velocityPressure(BOX.design));

/** Airflow the controller computes from a sensed ΔP, with its K factor possibly off */
export function flowFromVp(vp: number, kError = 0) {
  return K_FACTOR * (1 + kError) * Math.sqrt(Math.max(0, vp));
}

/** Transducer noise: small and deterministic, so tests and replays match */
function noise(t: number) {
  return BOX.noise * (0.6 * Math.sin(2.3 * t + 0.4) + 0.4 * Math.sin(5.7 * t + 1.3));
}

// ── dynamics ─────────────────────────────────────────────────────────────────────

const zoneCap = (PHYSICS.zoneTau * 1.08 * 400) / 3600; // Btu/°F, compressed-time room

export function init(inputs: VavInputs, seed: Partial<VavState> = {}): VavState {
  // start at a sensible operating point for these conditions unless a preset seeds otherwise
  const zone = seed.zone ?? inputs.zoneSp;
  const need = clamp(inputs.load / (1.08 * Math.max(1, zone - inputs.sat)), inputs.minFlow, inputs.maxFlow);
  const pos = seed.act ?? positionFor(need, inputs.staticIn) * 100;
  const blade = inputs.faults.stuck ? inputs.faults.stuckAt : (seed.blade ?? pos);
  const q = boxFlow(blade / 100, inputs.staticIn);
  const zoneOut = seed.zoneOut ?? (100 * (need - inputs.minFlow)) / Math.max(1, inputs.maxFlow - inputs.minFlow);
  const manual = inputs.override.mode === "manual";
  return {
    t: 0,
    zoneI: zoneOut,
    zoneOut,
    flowSp: need,
    flowI: pos,
    loopOut: pos,
    cmd: manual ? inputs.override.value : pos,
    activePriority: manual ? 8 : 16,
    act: pos,
    blade,
    q,
    qBas: flowFromVp(velocityPressure(q) + inputs.faults.vpOffset, inputs.faults.kError),
    zone,
    zoneSensor: zone,
    starvedFor: 0,
    ...seed,
  };
}

export function step(s: VavState, i: VavInputs, dt: number): VavState {
  // ── zone loop: warmer than setpoint → more airflow ──
  const zErr = s.zoneSensor - i.zoneSp;
  const zP = PHYSICS.zoneKp * zErr;
  let zoneI = s.zoneI + (PHYSICS.zoneKp / PHYSICS.zoneTi) * zErr * dt;
  zoneI = clamp(zoneI, -zP, 100 - zP);
  const zoneOut = clamp(zP + zoneI, 0, 100);
  const flowSp = i.minFlow + (zoneOut / 100) * (i.maxFlow - i.minFlow);

  // ── flow loop (pressure-independent) or straight to the damper (pressure-dependent) ──
  let flowI = s.flowI;
  let loopOut: number;
  if (i.control === "independent") {
    const err = ((flowSp - s.qBas) / BOX.design) * 100;
    const p = i.kp * err;
    flowI = i.ti > 0 ? flowI + (i.kp / i.ti) * err * dt : flowI;
    flowI = clamp(flowI, -p, 100 - p);
    loopOut = clamp(p + flowI, 0, 100);
  } else {
    loopOut = zoneOut;
    flowI = zoneOut;
  }

  // ── priority: operator @8 beats program @16 ──
  const manual = i.override.mode === "manual";
  const cmd = manual ? clamp(i.override.value, 0, 100) : loopOut;
  const activePriority: 8 | 16 = manual ? 8 : 16;

  // ── floating actuator: moves at stroke speed once the command is outside its deadband; a command at
  // either end drives it all the way to the stop (controllers overdrive there so the damper seats) ──
  let act = s.act;
  const target = cmd >= 99.5 ? 100 : cmd <= 0.5 ? 0 : cmd;
  const gap = target - act;
  if (Math.abs(gap) > PHYSICS.deadband || ((target === 100 || target === 0) && gap !== 0)) {
    const maxMove = (100 / PHYSICS.strokeTime) * dt;
    act = act + clamp(gap, -maxMove, maxMove);
  }
  let blade = clamp(s.blade, act - PHYSICS.backlash, act + PHYSICS.backlash);
  if (act >= 100) blade = 100;
  if (act <= 0) blade = 0;
  if (i.faults.stuck) blade = clamp(i.faults.stuckAt, 0, 100);
  blade = clamp(blade, 0, 100);

  // ── air: the duct settles fast; the controller reads it through the flow cross ──
  const t = s.t + dt;
  const qNow = boxFlow(blade / 100, staticAt(i, t));
  const q = s.q + (qNow - s.q) * (1 - Math.exp(-dt / PHYSICS.flowTau));
  const vpRead = velocityPressure(q) + i.faults.vpOffset + noise(t);
  const qRaw = flowFromVp(vpRead, i.faults.kError);
  const qBas = s.qBas + (qRaw - s.qBas) * (1 - Math.exp(-dt / PHYSICS.readTau));

  // ── room: heat in from the load, out with the supply air ──
  const dZone = ((i.load - 1.08 * q * (s.zone - i.sat)) / (zoneCap * 3600)) * dt;
  const zone = s.zone + dZone;
  const zoneSensor = s.zoneSensor + (zone - s.zoneSensor) * (1 - Math.exp(-dt / PHYSICS.sensorTau));

  // ── starved: wide open and still short, the box's cue to ask the fan for more static ──
  const starved = act >= 95 && qBas < flowSp * 0.92 && !manual;
  const starvedFor = starved ? s.starvedFor + dt : 0;

  return {
    t,
    zoneI,
    zoneOut,
    flowSp,
    flowI,
    loopOut,
    cmd,
    activePriority,
    act,
    blade,
    q,
    qBas,
    zone,
    zoneSensor,
    starvedFor,
  };
}

export function outputs(s: VavState, i: VavInputs) {
  const vpTrue = velocityPressure(s.q);
  const vpRead = vpTrue + i.faults.vpOffset;
  const staticNow = staticAt(i, s.t);
  const qMaxAvail = boxFlow(1, staticNow);
  const dpDown = BOX.dpDown * (s.q / BOX.design) ** 2;
  // a pressure-dependent box has no airflow sensor: no reading and no airflow setpoint to show
  const measured = i.control === "independent";
  return {
    // GLB drives (0–1)
    damperPos: s.blade / 100,
    actuatorPos: s.act / 100,
    // mode and points
    independent: i.control === "independent" ? 1 : 0,
    cmd: s.cmd,
    loopOut: s.loopOut,
    zoneLoop: s.zoneOut,
    activePriority: s.activePriority,
    manual: i.override.mode === "manual" ? 1 : 0,
    actuatorPct: s.act,
    bladePct: s.blade,
    // air
    q: s.q,
    qBas: measured ? s.qBas : NaN,
    flowSp: measured ? s.flowSp : NaN,
    /** How far the reading is from the truth, % of true airflow */
    readErrPct: measured && s.q > 1 ? ((s.qBas - s.q) / s.q) * 100 : NaN,
    minFlow: i.minFlow,
    maxFlow: i.maxFlow,
    qMaxAvail,
    airFlow: s.q / BOX.design,
    staticIn: staticNow,
    /** Pressure the damper burns to hold the airflow down, in. w.c. */
    dpDamper: Math.max(0, staticNow - dpDown),
    vpTrue,
    vpRead,
    // room
    zone: s.zone,
    zoneDisplayed: s.zoneSensor,
    zoneSp: i.zoneSp,
    sat: i.sat,
    load: i.load,
    // flags
    starved: measured && s.starvedFor > 3 ? 1 : 0,
    stuck: i.faults.stuck ? 1 : 0,
    vpOffset: i.faults.vpOffset,
    kError: i.faults.kError,
  };
}

export type VavOutputs = ReturnType<typeof outputs>;

export const DEFAULT_INPUTS: VavInputs = {
  control: "independent",
  staticIn: 1.0,
  staticSwing: 0,
  load: 8000,
  sat: 55,
  zoneSp: 74,
  minFlow: 150,
  maxFlow: 1000,
  kp: 1.6,
  ti: 4,
  override: { mode: "auto", value: 50 },
  faults: { vpOffset: 0, kError: 0, stuck: false, stuckAt: 40 },
};
