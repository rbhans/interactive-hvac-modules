/**
 * Economizer model — pure, deterministic, no rendering.
 *
 * Three layers are kept apart on purpose:
 *   command  — what the BAS writes (loop output, operator override, priority arbitration)
 *   feedback — what the BAS reads back (actuator position, MAT sensor incl. offset)
 *   physical — what the air actually does (blade position, OA fraction, true MAT)
 */

export type BladeType = "opposed" | "parallel";
export type OverrideMode = "auto" | "manual";

export interface EconInputs {
  /** Outdoor air temperature, °F */
  oat: number;
  /** Return air temperature, °F */
  rat: number;
  /** Mixed air temperature setpoint, °F */
  matSp: number;
  /** Minimum OA damper position, % */
  minOaPos: number;
  /** Dry-bulb high-limit changeover, °F */
  highLimit: number;
  /** Proportional gain, % per °F */
  kp: number;
  /** Integral time, s */
  ti: number;
  bladeType: BladeType;
  /** Damper authority: ΔP across the open damper ÷ ΔP across its whole path (0–1). Applied to OA and RA. */
  authority: number;
  /**
   * Return-path balance: the RA path's full-open flow relative to the OA path's, at the same
   * mixed-plenum suction. 1 = balanced. Below 1 the return side is weaker (long return ductwork,
   * no return fan); above 1 it is stronger (a return fan pressurizing the return plenum).
   */
  returnBalance: number;
  /** Operator override on the damper command, written at priority 8 */
  override: { mode: OverrideMode; value: number };
  faults: {
    /** Linkage slipped: the actuator keeps moving, the blades stay at `stuckAt` */
    stuckDamper: boolean;
    stuckAt: number;
    /** Added to the MAT reading only, °F */
    matOffset: number;
  };
}

export interface EconState {
  /** Simulation time, s */
  t: number;
  /** PI integral term, % */
  integral: number;
  /** PI output — what the program writes at priority 16, % */
  loopOut: number;
  econEnabled: boolean;
  /** Freeze protection: 0 off, 1 = OA held at minimum, 2 = OA closed. Written at priority 5. */
  freezeStage: 0 | 1 | 2;
  /** Seconds MAT has stayed above the release temperature while freeze protection is active */
  freezeClear: number;
  /** Effective damper command after priority arbitration, % */
  cmd: number;
  activePriority: Priority;
  /** Actuator shaft position — what the BAS reads as damper feedback, % */
  actuatorPos: number;
  /** Physical blade position, % */
  bladePos: number;
  /** Physical OA fraction of the supply air, 0–1 */
  oaFrac: number;
  /** Air in transit between the dampers and the sensor plane (transport lag stages), °F */
  transit: [number, number, number];
  /** Fully-mixed air temperature at the sensor plane, °F */
  matTrue: number;
  /** Sensor element temperature, °F (sensor lag applied, no offset) */
  matSensor: number;
  /** What the BAS displays and controls on, °F */
  matDisplayed: number;
}

export type Priority = 5 | 8 | 16;

/**
 * Physical constants, exported so tests and copy can reference them.
 *
 * Time is compressed about 7.5× so a lesson fits in seconds: a real ~90 s actuator strokes in
 * 12 s, and the sensor and transport lags and the default integral time are scaled to match.
 */
export const PHYSICS = {
  /** Full 0→100 % actuator stroke, s (a real 90 s actuator, compressed) */
  strokeTime: 12,
  /** Transport lag between the dampers and the sensor plane, per stage (3 stages), s */
  transitTau: 0.7,
  /** Averaging-element sensor lag, s */
  sensorTau: 2.5,
  /** Closed-damper leakage as a fraction of full-open inherent flow */
  leakage: 0.006,
  /** Changeover hysteresis below the high-limit before the economizer re-enables, °F */
  highLimitDeadband: 2,
} as const;

/**
 * Freeze protection on the mixed air, written at BACnet priority 5 (critical equipment control),
 * so it beats an operator at 8. A mixed-air low limit, staged in the spirit of ASHRAE Guideline 36.
 * G36 itself acts on supply-air temperature: below 40 °F for 5 min it holds minimum OA and runs the
 * heating coil to 42 °F, and below 38 °F for 5 min it closes the OA dampers for an hour. Real sequences
 * also have a hardwired freezestat that stops the fan.
 */
export const FREEZE = {
  /** Below this, hold the OA damper at minimum, °F */
  stage1: 40,
  /** Below this, close the OA damper, °F */
  stage2: 35,
  /** Release once MAT has stayed above this, °F … */
  release: 45,
  /** … for this long, s (compressed; about 2½ minutes real) */
  releaseHold: 20,
} as const;

/**
 * Inherent characteristic exponent, by blade type (flow ≈ position^k at constant ΔP).
 * Calibrated to the ASHRAE rule of thumb that the installed curve comes out near-linear at a
 * system-to-damper resistance ratio of about 10 for opposed blades (authority ≈ 0.09) and about
 * 2.5 for parallel blades (authority ≈ 0.29). Both inherent curves open slowly; opposed more so.
 */
const INHERENT_EXPONENT: Record<BladeType, number> = { opposed: 2.5, parallel: 1.75 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Inherent characteristic: flow fraction at constant pressure drop across the damper alone.
 * `pos` is 0–1.
 */
export function inherentCurve(pos: number, bladeType: BladeType): number {
  const x = clamp(pos, 0, 1);
  const { leakage } = PHYSICS;
  return leakage + (1 - leakage) * Math.pow(x, INHERENT_EXPONENT[bladeType]);
}

/**
 * Installed characteristic of one damper path: flow relative to full-open flow, once the damper
 * shares the path's pressure drop with louvers and ductwork (constant total ΔP across the path).
 *
 *   φ = 1 / √( N / f(x)² + (1 − N) )
 */
export function installedCurve(pos: number, authority: number, bladeType: BladeType): number {
  const n = clamp(authority, 0.01, 1);
  const f = inherentCurve(pos, bladeType);
  return 1 / Math.sqrt(n / (f * f) + (1 - n));
}

/**
 * OA fraction of the mixed air for linked OA and RA dampers (RA at 1 − x) drawing from a
 * common mixed-air plenum. Each path follows its installed characteristic; the return path is
 * scaled by `returnBalance`.
 *
 * With balanced paths the curve crosses 50/50 at mid-stroke by symmetry. The gap between
 * position and percentage is biggest at the low end of the stroke, where minimum OA lives,
 * and anything that unbalances the paths (a return fan, long return ductwork) shifts the whole curve.
 * Assumes equal air density on both paths.
 */
export function oaFraction(pos: number, authority: number, bladeType: BladeType, returnBalance = 1): number {
  const qOa = installedCurve(pos, authority, bladeType);
  const qRa = Math.max(0, returnBalance) * installedCurve(1 - pos, authority, bladeType);
  return qOa / (qOa + qRa);
}

/** Damper position (0–1) that delivers the given OA fraction. Bisection; the curve is monotonic. */
export function positionForFraction(frac: number, authority: number, bladeType: BladeType, returnBalance = 1): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (oaFraction(mid, authority, bladeType, returnBalance) < frac) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export const mixedAirTemp = (oaFrac: number, oat: number, rat: number) => oaFrac * oat + (1 - oaFrac) * rat;

export function init(inputs: EconInputs, seed: Partial<EconState> = {}): EconState {
  const pos = seed.bladePos ?? seed.actuatorPos ?? inputs.minOaPos;
  const actuatorPos = seed.actuatorPos ?? pos;
  const bladePos = inputs.faults.stuckDamper ? inputs.faults.stuckAt : (seed.bladePos ?? actuatorPos);
  const oaFrac = oaFraction(bladePos / 100, inputs.authority, inputs.bladeType, inputs.returnBalance);
  const mat = mixedAirTemp(oaFrac, inputs.oat, inputs.rat);
  const econEnabled = inputs.oat < inputs.highLimit;
  const loopOut = seed.loopOut ?? actuatorPos;
  const cmd = inputs.override.mode === "manual" ? inputs.override.value : loopOut;
  return {
    t: 0,
    integral: seed.integral ?? loopOut,
    loopOut,
    econEnabled,
    freezeStage: 0,
    freezeClear: 0,
    cmd,
    activePriority: inputs.override.mode === "manual" ? 8 : 16,
    actuatorPos,
    bladePos,
    oaFrac,
    transit: [mat, mat, mat],
    matTrue: mat,
    matSensor: mat,
    matDisplayed: mat + inputs.faults.matOffset,
    ...seed,
  };
}

/** Advance the model by `dt` seconds. Pure: returns a new state. */
export function step(s: EconState, i: EconInputs, dt: number): EconState {
  const minPos = clamp(i.minOaPos, 0, 100);

  // ── Changeover: dry-bulb high limit with hysteresis ──────────────────────────
  const econEnabled = s.econEnabled
    ? i.oat <= i.highLimit
    : i.oat < i.highLimit - PHYSICS.highLimitDeadband;

  // ── Freeze protection (BAS logic, so it acts on the displayed MAT) ─────────────
  let freezeStage = s.freezeStage;
  let freezeClear = 0;
  if (s.matDisplayed < FREEZE.stage2) freezeStage = 2;
  else if (s.matDisplayed < FREEZE.stage1) freezeStage = Math.max(freezeStage, 1) as 1 | 2;
  else if (freezeStage > 0 && s.matDisplayed > FREEZE.release) {
    freezeClear = s.freezeClear + dt;
    if (freezeClear >= FREEZE.releaseHold) {
      freezeStage = 0;
      freezeClear = 0;
    }
  }

  // ── MAT loop (direct acting: MAT above setpoint → open OA) ───────────────────
  let integral: number;
  let loopOut: number;
  if (econEnabled && freezeStage === 0) {
    const err = s.matDisplayed - i.matSp;
    const p = i.kp * err;
    integral = s.integral + (i.ti > 0 ? (i.kp / i.ti) * err * dt : 0);
    // Anti-windup: keep the integral where the total output stays inside [min, 100]
    integral = clamp(integral, minPos - p, 100 - p);
    loopOut = clamp(p + integral, minPos, 100);
  } else {
    // Locked out, or freeze protection holding the damper: the program writes minimum OA and the
    // integral tracks it, so control resumes from minimum instead of winding up behind the safety
    // and throwing the damper open on release
    const p = i.kp * (s.matDisplayed - i.matSp);
    loopOut = minPos;
    integral = minPos - p;
  }

  // ── Priority arbitration: safety @5 beats operator @8 beats program @16 ──────
  const manual = i.override.mode === "manual";
  let cmd: number;
  let activePriority: Priority;
  if (freezeStage > 0) {
    cmd = freezeStage === 2 ? 0 : minPos;
    activePriority = 5;
  } else if (manual) {
    cmd = clamp(i.override.value, 0, 100);
    activePriority = 8;
  } else {
    cmd = loopOut;
    activePriority = 16;
  }

  // ── Actuator: rate-limited travel toward command ─────────────────────────────
  const maxMove = (100 / PHYSICS.strokeTime) * dt;
  const actuatorPos = s.actuatorPos + clamp(cmd - s.actuatorPos, -maxMove, maxMove);

  // ── Physical blades: follow the shaft unless the linkage has slipped ────────
  const bladePos = i.faults.stuckDamper ? clamp(i.faults.stuckAt, 0, 100) : actuatorPos;

  // ── Air ──────────────────────────────────────────────────────────────────────
  const oaFrac = oaFraction(bladePos / 100, i.authority, i.bladeType, i.returnBalance);
  const matIdeal = mixedAirTemp(oaFrac, i.oat, i.rat);
  const a = 1 - Math.exp(-dt / PHYSICS.transitTau);
  const t0 = s.transit[0] + (matIdeal - s.transit[0]) * a;
  const t1 = s.transit[1] + (t0 - s.transit[1]) * a;
  const t2 = s.transit[2] + (t1 - s.transit[2]) * a;
  const matTrue = t2;
  const matSensor = s.matSensor + (matTrue - s.matSensor) * (1 - Math.exp(-dt / PHYSICS.sensorTau));
  const matDisplayed = matSensor + i.faults.matOffset;

  return {
    t: s.t + dt,
    integral,
    loopOut,
    econEnabled,
    freezeStage,
    freezeClear,
    cmd,
    activePriority,
    actuatorPos,
    bladePos,
    oaFrac,
    transit: [t0, t1, t2],
    matTrue,
    matSensor,
    matDisplayed,
  };
}

/** Flat, named outputs consumed by bindings, readouts, callouts and trends. */
export function outputs(s: EconState, i: EconInputs) {
  const reliefFrac = Math.max(0, s.oaFrac - 0.06); // building pressurization keeps a little OA
  // What a BAS can infer without an airflow station: the temperature method.
  // Meaningless when OAT ≈ RAT, and wrong whenever the MAT sensor is.
  const dT = i.rat - i.oat;
  const oaPctCalc = Math.abs(dT) < 10 ? NaN : clamp(((i.rat - s.matDisplayed) / dT) * 100, -50, 150);
  return {
    // normalized drives for the GLB (0–1)
    oaBladePos: s.bladePos / 100,
    raBladePos: 1 - s.bladePos / 100,
    eaBladePos: s.bladePos / 100,
    actuatorPos: s.actuatorPos / 100,
    fanSpeed: 1,
    // flows (0–1) and temperatures (°F)
    oaFlow: s.oaFrac,
    raFlow: 1 - s.oaFrac,
    eaFlow: reliefFrac,
    maFlow: 1,
    oat: i.oat,
    rat: i.rat,
    // points
    cmd: s.cmd,
    loopOut: s.loopOut,
    actuatorPosPct: s.actuatorPos,
    bladePosPct: s.bladePos,
    oaPct: s.oaFrac * 100,
    oaPctCalc,
    matTrue: s.matTrue,
    matDisplayed: s.matDisplayed,
    matSp: i.matSp,
    econEnabled: s.econEnabled ? 1 : 0,
    // from the current inputs, so an override shows its priority at once, even while paused
    activePriority: s.freezeStage > 0 ? 5 : i.override.mode === "manual" ? 8 : 16,
    freezeStage: s.freezeStage,
    /** Value written at priority 5 by freeze protection, or NaN when that slot is empty */
    p5: s.freezeStage === 2 ? 0 : s.freezeStage === 1 ? clamp(i.minOaPos, 0, 100) : NaN,
    manual: i.override.mode === "manual" ? 1 : 0,
    stuck: i.faults.stuckDamper ? 1 : 0,
    matOffset: i.faults.matOffset,
  };
}

export type EconOutputs = ReturnType<typeof outputs>;

export const DEFAULT_INPUTS: EconInputs = {
  oat: 48,
  rat: 72,
  matSp: 55,
  minOaPos: 20,
  highLimit: 70,
  kp: 4,
  ti: 12,
  bladeType: "opposed",
  authority: 0.1,
  returnBalance: 1,
  override: { mode: "auto", value: 50 },
  faults: { stuckDamper: false, stuckAt: 8, matOffset: 0 },
};
