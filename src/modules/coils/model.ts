/**
 * Coil section model: pure, deterministic, no rendering.
 *
 * Air passes a hot-water heating coil, then a chilled-water cooling coil. One discharge-air
 * loop drives whichever valve the mode calls for; the other valve is commanded shut (and may leak).
 *
 * The same three layers as the economizer:
 *   command  — loop output, operator override, priority arbitration
 *   feedback — valve actuator position, discharge-air sensor (incl. offset)
 *   physical — stem position, water flow, heat moved, true air and water temperatures
 *
 * Coil types are table-driven (COILS) so DX, gas and electric heat can be added as more entries.
 */

export type CoilMode = "cooling" | "heating";
export type CoilId = "chw" | "hw";
export type ValveChar = "equal" | "linear";
export type ValveSize = "right" | "oversized";
export type OverrideMode = "auto" | "manual";

export interface CoilInputs {
  mode: CoilMode;
  /** Entering (mixed) air temperature, °F */
  eat: number;
  /** Entering relative humidity, % — only matters for condensate on the cooling coil */
  rh: number;
  /** Airflow as % of design */
  airflow: number;
  /** Chilled water supply temperature, °F */
  chwEwt: number;
  /** Hot water supply temperature, °F */
  hwEwt: number;
  /** Discharge air setpoints, °F */
  coolSp: number;
  heatSp: number;
  /** % per °F and s */
  kp: number;
  ti: number;
  valveChar: ValveChar;
  valveSize: ValveSize;
  /** Operator override on the active valve, written at priority 8 */
  override: { mode: OverrideMode; value: number };
  faults: {
    /** Flow through a "closed" valve, as a fraction of its full-open flow */
    hwLeak: number;
    chwLeak: number;
    /** The active valve's stem stuck at `stuckAt` % */
    stuck: boolean;
    stuckAt: number;
    /** Added to the discharge-air reading only, °F */
    datOffset: number;
  };
}

export interface CoilState {
  t: number;
  integral: number;
  loopOut: number;
  cmd: number;
  activePriority: 8 | 16;
  /** Actuator (feedback) and physical stem positions, % */
  act: Record<CoilId, number>;
  stem: Record<CoilId, number>;
  /** Air leaving each coil (lagged by coil mass), °F */
  lat: Record<CoilId, number>;
  /** Water leaving each coil (lagged), °F */
  lwt: Record<CoilId, number>;
  /** Discharge sensor element (lagged, no offset) and what the BAS shows, °F */
  datSensor: number;
  datDisplayed: number;
  lastMode: CoilMode;
  /** The valve whose stem stuck: the one active when the fault began. It stays stuck through a mode change. */
  stuckValve: CoilId | null;
}

// ── physical constants ─────────────────────────────────────────────────────────

/**
 * Time is compressed like the economizer (~7×): a real ~90 s valve actuator strokes in 12 s,
 * coil and sensor lags are scaled to match.
 */
export const PHYSICS = {
  strokeTime: 12,
  coilTau: 3.5,
  sensorTau: 2,
  /** Design airflow through the section, cfm */
  cfm: 2500,
  /** Air-side and water-side film coefficients scale as flow^n */
  airExp: 0.7,
  waterExp: 0.8,
  /**
   * Stem backlash / stiction, % of stroke. Every real valve has some; it's harmless where the
   * valve's curve is gentle and makes an oversized valve hunt near shutoff, where a 1 % move is a big step in flow.
   */
  backlash: 1.5,
} as const;

export interface CoilSpec {
  id: CoilId;
  label: string;
  /** +1 heats the air, −1 cools it */
  sign: 1 | -1;
  /** Design water flow, gpm */
  gpm: number;
  /** Design air-side and water-side conductance, Btu/h·°F */
  hAa: number;
  hAw: number;
}

/**
 * Sized so that at design flows:
 *   cooling  78 °F air, 44 °F water → 55 °F air, 12 °F water rise (≈ 62 MBH sensible, 5 tons)
 *   heating  50 °F air, 180 °F water → 90 °F air, 20 °F water drop (≈ 108 MBH)
 * Air-side film resistance is ~70 % of the total, typical of finned coils.
 */
export const COILS: Record<CoilId, CoilSpec> = {
  chw: { id: "chw", label: "Chilled water", sign: -1, gpm: 10.35, hAa: 5574, hAw: 13007 },
  hw: { id: "hw", label: "Hot water", sign: 1, gpm: 10.8, hAa: 1549, hAw: 3613 },
};

export const activeCoil = (mode: CoilMode): CoilId => (mode === "cooling" ? "chw" : "hw");

// ── valves ─────────────────────────────────────────────────────────────────────

/** Rangeability of the equal-percentage characteristic */
const RANGEABILITY = 30;

/** Authority and full-open flow (× design) for each valve size. An oversized valve passes more and controls worse. */
export const VALVE_SIZES: Record<ValveSize, { authority: number; maxFlow: number }> = {
  right: { authority: 0.5, maxFlow: 1.05 },
  oversized: { authority: 0.12, maxFlow: 1.35 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Inherent characteristic (flow fraction at constant ΔP), x in 0–1. Modified equal-percentage reaches 0 at closed. */
export function valveInherent(x: number, char: ValveChar): number {
  const p = clamp(x, 0, 1);
  return char === "equal" ? (Math.pow(RANGEABILITY, p) - 1) / (RANGEABILITY - 1) : p;
}

/** Installed characteristic: the valve shares the circuit's pressure drop. Same math as a damper. */
export function valveInstalled(x: number, char: ValveChar, authority: number): number {
  const f = valveInherent(x, char);
  if (f <= 0) return 0;
  const n = clamp(authority, 0.01, 1);
  return 1 / Math.sqrt(n / (f * f) + (1 - n));
}

/** Water flow as a fraction of design flow at stem position x (0–1), including leak-by. */
export function valveFlow(x: number, char: ValveChar, size: ValveSize, leak = 0): number {
  const s = VALVE_SIZES[size];
  return Math.max(valveInstalled(x, char, s.authority), clamp(leak, 0, 1)) * s.maxFlow;
}

// ── coil heat transfer (ε-NTU, counterflow: multi-row coils are close to it) ────

function effectiveness(ntu: number, cr: number) {
  if (ntu <= 0) return 0;
  if (Math.abs(1 - cr) < 1e-6) return ntu / (1 + ntu);
  const e = Math.exp(-ntu * (1 - cr));
  return (1 - e) / (1 - cr * e);
}

export interface CoilResult {
  /** Heat into the air, Btu/h (negative when cooling) */
  q: number;
  lat: number;
  lwt: number;
  /** Water temperature change magnitude, °F */
  dtWater: number;
  /** Fin surface temperature estimate, °F (for condensation) */
  surface: number;
}

/** Steady-state coil performance. gpmFrac and airFrac are fractions of design flow. */
export function coilSteady(spec: CoilSpec, eat: number, ewt: number, gpmFrac: number, airFrac: number): CoilResult {
  const cfm = PHYSICS.cfm * Math.max(0.05, airFrac);
  const gpm = spec.gpm * Math.max(0, gpmFrac);
  const cAir = 1.08 * cfm;
  if (gpm < 1e-4) return { q: 0, lat: eat, lwt: ewt, dtWater: 0, surface: eat };
  const cW = 500 * gpm;
  const hAa = spec.hAa * Math.pow(cfm / PHYSICS.cfm, PHYSICS.airExp);
  const hAw = spec.hAw * Math.pow(gpmFrac, PHYSICS.waterExp);
  const ua = 1 / (1 / hAa + 1 / hAw);
  const cMin = Math.min(cAir, cW);
  const cMax = Math.max(cAir, cW);
  const eps = effectiveness(ua / cMin, cMin / cMax);
  const q = eps * cMin * (ewt - eat);
  const lat = eat + q / cAir;
  const lwt = ewt - q / cW;
  // fin surface sits between water and air, weighted by the film resistances
  const tw = (ewt + lwt) / 2;
  const ta = (eat + lat) / 2;
  const surface = tw + (ta - tw) * (1 / hAw / (1 / hAw + 1 / hAa));
  return { q, lat, lwt, dtWater: Math.abs(ewt - lwt), surface };
}

/** Heat moved at design water temperatures as a fraction of the full-open value: the coil's own curve. */
export function coilCurve(spec: CoilSpec, eat: number, ewt: number, gpmFrac: number, airFrac: number, fullFrac = 1): number {
  const full = coilSteady(spec, eat, ewt, fullFrac, airFrac).q;
  return full === 0 ? 0 : coilSteady(spec, eat, ewt, gpmFrac, airFrac).q / full;
}

/** Dew point from dry bulb (°F) and RH (%), Magnus formula. */
export function dewPoint(tF: number, rh: number) {
  const t = ((tF - 32) * 5) / 9;
  const a = 17.62;
  const b = 243.12;
  const g = Math.log(clamp(rh, 1, 100) / 100) + (a * t) / (b + t);
  return ((b * g) / (a - g)) * 9 / 5 + 32;
}

// ── dynamics ─────────────────────────────────────────────────────────────────────

export function init(inputs: CoilInputs, seed: Partial<CoilState> = {}): CoilState {
  const active = activeCoil(inputs.mode);
  const pos = seed.act?.[active] ?? 0;
  const act = { chw: 0, hw: 0, ...seed.act, [active]: pos } as Record<CoilId, number>;
  const stem = { ...act };
  const stuckValve = inputs.faults.stuck ? (seed.stuckValve ?? active) : null;
  if (stuckValve) stem[stuckValve] = inputs.faults.stuckAt;
  const air = inputs.airflow / 100;
  const hw = coilSteady(COILS.hw, inputs.eat, inputs.hwEwt, valveFlow(stem.hw / 100, inputs.valveChar, inputs.valveSize, inputs.faults.hwLeak), air);
  const chw = coilSteady(COILS.chw, hw.lat, inputs.chwEwt, valveFlow(stem.chw / 100, inputs.valveChar, inputs.valveSize, inputs.faults.chwLeak), air);
  const loopOut = seed.loopOut ?? pos;
  const manual = inputs.override.mode === "manual";
  return {
    t: 0,
    integral: seed.integral ?? loopOut,
    loopOut,
    cmd: manual ? inputs.override.value : loopOut,
    activePriority: manual ? 8 : 16,
    act,
    stem,
    lat: { hw: hw.lat, chw: chw.lat },
    lwt: { hw: hw.lwt, chw: chw.lwt },
    datSensor: chw.lat,
    datDisplayed: chw.lat + inputs.faults.datOffset,
    lastMode: inputs.mode,
    ...seed,
    stuckValve,
  };
}

export function step(s: CoilState, i: CoilInputs, dt: number): CoilState {
  const active = activeCoil(i.mode);

  // ── discharge-air loop: cooling opens CHW when warm, heating opens HW when cold ──
  let integral = s.integral;
  if (i.mode !== s.lastMode) integral = 0; // mode change: start the new valve from shut
  const err = i.mode === "cooling" ? s.datDisplayed - i.coolSp : i.heatSp - s.datDisplayed;
  const p = i.kp * err;
  integral = i.ti > 0 ? integral + (i.kp / i.ti) * err * dt : integral;
  integral = clamp(integral, 0 - p, 100 - p);
  const loopOut = clamp(p + integral, 0, 100);

  // ── priority: operator @8 beats program @16 (on the active valve) ──
  const manual = i.override.mode === "manual";
  const cmd = manual ? clamp(i.override.value, 0, 100) : loopOut;
  const activePriority: 8 | 16 = manual ? 8 : 16;

  // ── actuators: the active valve follows cmd, the other is driven shut ──
  const maxMove = (100 / PHYSICS.strokeTime) * dt;
  const act = { ...s.act };
  for (const id of ["chw", "hw"] as CoilId[]) {
    const target = id === active ? cmd : 0;
    act[id] = s.act[id] + clamp(target - s.act[id], -maxMove, maxMove);
  }
  // stems follow their actuators through a little backlash; a valve driven to either end of its stroke gets there
  const stem = { ...s.stem };
  for (const id of ["chw", "hw"] as CoilId[]) {
    stem[id] = clamp(stem[id], act[id] - PHYSICS.backlash, act[id] + PHYSICS.backlash);
    if (act[id] <= PHYSICS.backlash * 0.5) stem[id] = Math.min(stem[id], act[id]);
    if (act[id] >= 100 - PHYSICS.backlash * 0.5) stem[id] = Math.max(stem[id], act[id]);
    stem[id] = clamp(stem[id], 0, 100);
  }
  const stuckValve = stuckValveFor(s, i);
  if (stuckValve) stem[stuckValve] = clamp(i.faults.stuckAt, 0, 100);

  // ── air through both coils, in series ──
  const air = i.airflow / 100;
  const hw = coilSteady(COILS.hw, i.eat, i.hwEwt, valveFlow(stem.hw / 100, i.valveChar, i.valveSize, i.faults.hwLeak), air);
  const k = 1 - Math.exp(-dt / PHYSICS.coilTau);
  const latHw = s.lat.hw + (hw.lat - s.lat.hw) * k;
  const chw = coilSteady(COILS.chw, latHw, i.chwEwt, valveFlow(stem.chw / 100, i.valveChar, i.valveSize, i.faults.chwLeak), air);
  const latChw = s.lat.chw + (chw.lat - s.lat.chw) * k;
  const lwt = { hw: s.lwt.hw + (hw.lwt - s.lwt.hw) * k, chw: s.lwt.chw + (chw.lwt - s.lwt.chw) * k };

  const datSensor = s.datSensor + (latChw - s.datSensor) * (1 - Math.exp(-dt / PHYSICS.sensorTau));

  return {
    t: s.t + dt,
    integral,
    loopOut,
    cmd,
    activePriority,
    act,
    stem,
    lat: { hw: latHw, chw: latChw },
    lwt,
    datSensor,
    datDisplayed: datSensor + i.faults.datOffset,
    lastMode: i.mode,
    stuckValve,
  };
}

/** The stuck fault belongs to the valve that was active when it began, not to whichever valve is active now. */
function stuckValveFor(s: CoilState, i: CoilInputs): CoilId | null {
  return i.faults.stuck ? (s.stuckValve ?? activeCoil(i.mode)) : null;
}

/** Flat outputs for bindings, readouts, callouts and trends. */
export function outputs(s: CoilState, i: CoilInputs) {
  const active = activeCoil(i.mode);
  const air = i.airflow / 100;
  const cAir = 1.08 * PHYSICS.cfm * Math.max(0.05, air);
  const flow = {
    hw: valveFlow(s.stem.hw / 100, i.valveChar, i.valveSize, i.faults.hwLeak),
    chw: valveFlow(s.stem.chw / 100, i.valveChar, i.valveSize, i.faults.chwLeak),
  };
  // heat moved from the (lagged) air temperatures — consistent with what the particles show
  const qHw = cAir * (s.lat.hw - i.eat);
  const qChw = cAir * (s.lat.chw - s.lat.hw);
  const design = {
    chw: -coilSteady(COILS.chw, 78, 44, 1, 1).q,
    hw: coilSteady(COILS.hw, 50, 180, 1, 1).q,
  };
  const qActive = active === "chw" ? -qChw : qHw;
  // what the coil could do right now with the valve wide open (same entering conditions)
  const entering = active === "chw" ? s.lat.hw : i.eat;
  const ewt = active === "chw" ? i.chwEwt : i.hwEwt;
  const fullOpen = coilSteady(COILS[active], entering, ewt, VALVE_SIZES[i.valveSize].maxFlow, air);
  const dtw = { hw: Math.abs(i.hwEwt - s.lwt.hw), chw: Math.abs(s.lwt.chw - i.chwEwt) };

  // condensate: fin surface below the entering dew point
  const chwNow = coilSteady(COILS.chw, s.lat.hw, i.chwEwt, flow.chw, air);
  const dp = dewPoint(i.eat, i.rh);
  const condensate = flow.chw > 0.005 ? clamp((dp - chwNow.surface) / 8, 0, 1) : 0;

  return {
    // GLB drives (0–1)
    chwValvePos: s.stem.chw / 100,
    hwValvePos: s.stem.hw / 100,
    fanSpeed: air,
    // mode
    cooling: i.mode === "cooling" ? 1 : 0,
    // loop / points
    cmd: s.cmd,
    loopOut: s.loopOut,
    // from the current inputs, so an override shows its priority at once, even while paused
    activePriority: i.override.mode === "manual" ? 8 : 16,
    manual: i.override.mode === "manual" ? 1 : 0,
    actuatorPct: s.act[active],
    stemPct: s.stem[active],
    datDisplayed: s.datDisplayed,
    datTrue: s.lat.chw,
    sp: i.mode === "cooling" ? i.coolSp : i.heatSp,
    // air
    eat: i.eat,
    afterHw: s.lat.hw,
    airFlow: air,
    hwRise: s.lat.hw - i.eat,
    chwDrop: s.lat.hw - s.lat.chw,
    // water
    chwFlow: flow.chw,
    hwFlow: flow.hw,
    activeFlowPct: flow[active] * 100,
    chwEwt: i.chwEwt,
    hwEwt: i.hwEwt,
    chwLwt: s.lwt.chw,
    hwLwt: s.lwt.hw,
    chwDt: dtw.chw,
    hwDt: dtw.hw,
    activeDt: dtw[active],
    // heat
    qHw,
    qChw,
    capacityPct: (qActive / design[active]) * 100,
    fullOpenPct: (Math.abs(fullOpen.q) / design[active]) * 100,
    /** The insight in two numbers: share of the valve's full-open water, and share of the heat the coil could move right now */
    flowOfMax: (flow[active] / VALVE_SIZES[i.valveSize].maxFlow) * 100,
    capOfMax: fullOpen.q === 0 ? 0 : (qActive / Math.abs(fullOpen.q)) * 100,
    tons: -qChw / 12000,
    mbh: qHw / 1000,
    // wasted: the idle coil working against the active one
    fightBtuh: active === "chw" ? Math.max(0, qHw) : Math.max(0, -qChw),
    condensate,
    dewPoint: dp,
    // faults
    stuck: i.faults.stuck ? 1 : 0,
    stuckChw: stuckValveFor(s, i) === "chw" ? 1 : 0,
    stuckHw: stuckValveFor(s, i) === "hw" ? 1 : 0,
    hwLeak: i.faults.hwLeak,
    chwLeak: i.faults.chwLeak,
    datOffset: i.faults.datOffset,
  };
}

export type CoilOutputs = ReturnType<typeof outputs>;

export const DEFAULT_INPUTS: CoilInputs = {
  mode: "cooling",
  eat: 78,
  rh: 55,
  airflow: 100,
  chwEwt: 44,
  hwEwt: 180,
  coolSp: 55,
  heatSp: 72,
  kp: 3,
  ti: 12,
  valveChar: "equal",
  valveSize: "right",
  override: { mode: "auto", value: 50 },
  faults: { hwLeak: 0, chwLeak: 0, stuck: false, stuckAt: 20, datOffset: 0 },
};
