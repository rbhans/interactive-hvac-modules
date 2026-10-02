/**
 * Pumps & VFDs model: pure, deterministic, no rendering.
 *
 * A chilled-water pump on a closed loop. The building needs some flow; there are two ways to get less
 * than the pump makes on its own: close the triple-duty valve on the discharge (the pump keeps running
 * at 60 Hz and rides up its curve), or slow the pump on its VFD (valve wide open). Same flow either way;
 * very different power.
 *
 * The same three layers as the other modules:
 *   command  — a flow loop driving either the valve or the drive speed; an operator override (Hand) on
 *              the drive at priority 8
 *   feedback — the flow meter, the suction and discharge gauges, the drive's speed and kW
 *   physical — where the pump curve meets the system curve, the head the valve burns, the efficiency
 *
 * Pump curve at speed fraction n (affinity-scaled): H = n²·H0 − (H0/Qmax²)·Q². The loop is closed, so the
 * system curve goes through the origin: H = K·Q². Together: Q = n·√(H0 / (H0/Qmax² + K)).
 */

export type Method = "valve" | "vfd";
export type PumpSize = "right" | "oversized";
export type OverrideMode = "auto" | "manual";

export interface PumpInputs {
  /** How the flow loop gets the flow it wants: throttle the valve, or slow the pump */
  method: Method;
  /** Flow wanted, gpm */
  flowSp: number;
  size: PumpSize;
  /** Drive speed override (Hand), %, written at priority 8 */
  override: { mode: OverrideMode; value: number };
  faults: {
    /** Motor wired backwards: the impeller spins the wrong way */
    reversed: boolean;
    /** Suction strainer clogging, 0–1 (1 = its resistance up twelvefold) */
    clog: number;
  };
}

export interface PumpState {
  t: number;
  /** Flow loop integral and output, % (valve opening or drive speed, depending on the method) */
  loopI: number;
  loopOut: number;
  /** Drive speed command after priority arbitration, and the drive's actual speed, % */
  speedCmd: number;
  speed: number;
  /** Triple-duty valve position, % open */
  valve: number;
  activePriority: 8 | 16;
  /** Flow, gpm (lagged: the water column has inertia), and the meter's reading */
  q: number;
  qMeter: number;
}

// ── the pump and the loop ───────────────────────────────────────────────────────

/** Design: 400 gpm against 70 ft of head */
export const DESIGN = { flow: 400, head: 70 } as const;

export const PUMPS = {
  /** Picked for the design point: 400 gpm at 70 ft, near its best efficiency */
  right: { label: "Right size", h0: 90, qMax: 849, bep: 420, etaMax: 0.78, hp: 15 },
  /** One size up "to be safe": 400 gpm at about 100 ft */
  oversized: { label: "Oversized", h0: 120, qMax: 980, bep: 520, etaMax: 0.8, hp: 20 },
} as const;

export const LOOP = {
  /** Head lost in the piping, coils and fittings at design flow, ft */
  piping: 62,
  /** Clean suction strainer, ft at design flow; a clogged one up to 12× */
  strainer: 3,
  clogMax: 12,
  /** Triple-duty valve wide open, ft at design flow */
  valve: 5,
  /** Valve characteristic: flow coefficient fraction = R^(x − 1), shut below 3 % */
  rangeability: 30,
  /** Loop fill pressure at the pump suction, psi */
  fill: 22,
} as const;

/** Motor wired backwards: a centrifugal pump still pumps, badly */
export const REVERSED = { head: 0.42, flow: 0.6, eta: 0.5 } as const;

export const PHYSICS = {
  /** Water column lag, s */
  flowTau: 1.2,
  meterTau: 0.5,
  /** Drive ramp, % per s; slowest it runs, % */
  ramp: 12,
  minSpeed: 30,
  /** Valve actuator stroke, s */
  valveStroke: 20,
  /** Flow loop: % per % of design flow error, reset time s */
  kp: 0.5,
  ti: 3,
} as const;

/** Pressure per foot of water head, psi */
export const PSI_PER_FT = 0.4335;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sq = (x: number) => x * x;

export function pumpSpec(i: PumpInputs) {
  const p = PUMPS[i.size];
  if (!i.faults.reversed) return { h0: p.h0, qMax: p.qMax, bep: p.bep, etaMax: p.etaMax, hp: p.hp };
  return { h0: p.h0 * REVERSED.head, qMax: p.qMax * REVERSED.flow, bep: p.bep * REVERSED.flow, etaMax: p.etaMax * REVERSED.eta, hp: p.hp };
}

/** Pump head at flow q (gpm) and speed fraction n */
export function pumpHead(q: number, n: number, i: PumpInputs) {
  const s = pumpSpec(i);
  return n * n * s.h0 - (s.h0 / sq(s.qMax)) * q * q;
}

/** Triple-duty valve: head it takes at q, open fraction x */
export function valveHead(q: number, x: number) {
  const f = x < 0.03 ? 0.002 : Math.pow(LOOP.rangeability, clamp(x, 0, 1) - 1);
  return (LOOP.valve / sq(DESIGN.flow) / (f * f)) * q * q;
}

export function strainerHead(q: number, i: PumpInputs) {
  return LOOP.strainer * (1 + (LOOP.clogMax - 1) * clamp(i.faults.clog, 0, 1)) * sq(q / DESIGN.flow);
}

/** The pipes, coils and strainer without the valve: H = K·Q² */
export function pipesK(i: PumpInputs) {
  return (LOOP.piping + LOOP.strainer * (1 + (LOOP.clogMax - 1) * clamp(i.faults.clog, 0, 1))) / sq(DESIGN.flow);
}

/** System resistance with the valve at x: H = K·Q² */
export function systemK(x: number, i: PumpInputs) {
  const kValve = x < 0.03 ? LOOP.valve / sq(0.002) : LOOP.valve / sq(Math.pow(LOOP.rangeability, clamp(x, 0, 1) - 1));
  return (LOOP.piping + LOOP.strainer * (1 + (LOOP.clogMax - 1) * clamp(i.faults.clog, 0, 1)) + kValve) / sq(DESIGN.flow);
}

/** Steady flow where the pump curve at speed n meets the system with the valve at x */
export function operatingFlow(n: number, x: number, i: PumpInputs) {
  const s = pumpSpec(i);
  return n * Math.sqrt(s.h0 / (s.h0 / sq(s.qMax) + systemK(x, i)));
}

/** Pump efficiency at q and n: peaks at the best efficiency point, which slides with speed */
export function pumpEfficiency(q: number, n: number, i: PumpInputs) {
  const s = pumpSpec(i);
  if (n < 0.05) return 0.1;
  const r = q / n / s.bep;
  return s.etaMax * clamp(1 - sq(r - 1), 0.08, 1);
}

/** Motor and drive together: a little worse slowed down */
export function driveEfficiency(n: number) {
  return 0.92 - 0.12 * sq(1 - clamp(n, 0, 1));
}

/** Electrical kW to pump q gpm against head h ft at speed n */
export function pumpKw(q: number, h: number, n: number, i: PumpInputs) {
  const s = pumpSpec(i);
  const hydraulic = (Math.max(0, q) * Math.max(0, h)) / 3960; // hp
  // a pump pumping nothing still churns: about a third of its power at its best point, scaled with speed³
  const atBep = (s.bep * (s.h0 - (s.h0 / sq(s.qMax)) * sq(s.bep))) / 3960 / s.etaMax;
  const bhp = Math.max(hydraulic / pumpEfficiency(q, n, i), 0.35 * atBep * n * n * n);
  return (bhp * 0.746) / driveEfficiency(n);
}

/** Speed fraction that makes flow q with the valve wide open */
export function speedFor(q: number, i: PumpInputs) {
  return q / operatingFlow(1, 1, i);
}

/** Valve opening that makes flow q at full speed (1 if even wide open can't) */
export function valveFor(q: number, i: PumpInputs) {
  let lo = 0;
  let hi = 1;
  if (operatingFlow(1, 1, i) <= q) return 1;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (operatingFlow(1, m, i) < q) lo = m;
    else hi = m;
  }
  return hi;
}

/** Power to make flow q each way: throttled at full speed, or slowed with the valve open */
export function bothWays(q: number, i: PumpInputs) {
  const x = valveFor(q, i);
  const qv = operatingFlow(1, x, i);
  const throttled = pumpKw(qv, pumpHead(qv, 1, i), 1, i);
  const n = clamp(speedFor(q, i), PHYSICS.minSpeed / 100, 1);
  const qs = operatingFlow(n, 1, i);
  const slowed = pumpKw(qs, pumpHead(qs, n, i), n, i);
  return { throttled, slowed, valve: x, speed: n };
}

/** Deterministic meter noise */
function noise(t: number) {
  return 0.6 * Math.sin(2.1 * t + 0.3) + 0.4 * Math.sin(5.3 * t + 1.7);
}

// ── dynamics ─────────────────────────────────────────────────────────────────────

export function init(inputs: PumpInputs, seed: Partial<PumpState> = {}): PumpState {
  const manual = inputs.override.mode === "manual";
  let speed = 100;
  let valve = 100;
  if (inputs.method === "valve") valve = valveFor(inputs.flowSp, inputs) * 100;
  else speed = clamp(speedFor(inputs.flowSp, inputs) * 100, PHYSICS.minSpeed, 100);
  if (manual) speed = clamp(inputs.override.value, 0, 100);
  const sp = seed.speed ?? speed;
  const vp = seed.valve ?? valve;
  const q = operatingFlow(sp / 100, vp / 100, inputs);
  const out = inputs.method === "valve" ? vp : sp;
  return {
    t: 0,
    loopI: out,
    loopOut: out,
    speedCmd: sp,
    speed: sp,
    valve: vp,
    activePriority: manual ? 8 : 16,
    q,
    qMeter: q,
    ...seed,
  };
}

export function step(s: PumpState, i: PumpInputs, dt: number): PumpState {
  const t = s.t + dt;
  // ── flow loop: drives the valve (pump at full speed) or the speed (valve wide open) ──
  const err = ((i.flowSp - s.qMeter) / DESIGN.flow) * 100;
  const p = PHYSICS.kp * err;
  const lo = i.method === "vfd" ? PHYSICS.minSpeed : 0;
  const loopI = clamp(s.loopI + (PHYSICS.kp / PHYSICS.ti) * err * dt, lo - p, 100 - p);
  const loopOut = clamp(p + loopI, lo, 100);

  // ── the drive: Hand at priority 8 beats the program at 16 ──
  const manual = i.override.mode === "manual";
  const program = i.method === "vfd" ? loopOut : 100;
  const speedCmd = manual ? clamp(i.override.value, 0, 100) : program;
  const speed = s.speed + clamp(speedCmd - s.speed, -PHYSICS.ramp * dt, PHYSICS.ramp * dt);

  // ── the valve: the loop's output in valve mode; wide open when the drive does the work ──
  const valveCmd = i.method === "valve" ? loopOut : 100;
  const valve = s.valve + clamp(valveCmd - s.valve, (-100 / PHYSICS.valveStroke) * dt, (100 / PHYSICS.valveStroke) * dt);

  // ── the water ──
  const qNow = operatingFlow(speed / 100, valve / 100, i);
  const q = s.q + (qNow - s.q) * (1 - Math.exp(-dt / PHYSICS.flowTau));
  const qMeter = s.qMeter + (q + noise(t) - s.qMeter) * (1 - Math.exp(-dt / PHYSICS.meterTau));

  return { t, loopI, loopOut, speedCmd, speed, valve, activePriority: manual ? 8 : 16, q, qMeter };
}

export function outputs(s: PumpState, i: PumpInputs) {
  const n = s.speed / 100;
  const x = s.valve / 100;
  const spec = pumpSpec(i);
  const head = Math.max(0, pumpHead(s.q, n, i));
  const hValve = valveHead(s.q, x);
  const hStrainer = strainerHead(s.q, i);
  const kw = pumpKw(s.q, head, n, i);
  const eff = pumpEfficiency(s.q, n, i);
  const ways = bothWays(s.q, i);
  const kwDesign = pumpKw(DESIGN.flow, pumpHead(DESIGN.flow, speedFor(DESIGN.flow, i), i), speedFor(DESIGN.flow, i), i);
  // gauges: the suction sees the fill pressure less the strainer; the discharge adds the pump's head
  const suction = LOOP.fill - hStrainer * PSI_PER_FT;
  const discharge = suction + head * PSI_PER_FT;
  return {
    // GLB drives (0–1)
    pumpSpeed: n,
    /** how far the valve's handwheel has been turned in from wide open */
    valveTravel: 1 - x,
    suctionGauge: clamp(suction / 60, 0, 1),
    dischargeGauge: clamp(discharge / 100, 0, 1),
    // control
    vfd: i.method === "vfd" ? 1 : 0,
    flowSp: i.flowSp,
    loopOut: s.loopOut,
    speedCmd: s.speedCmd,
    speedPct: s.speed,
    hz: n * 60,
    activePriority: s.activePriority,
    manual: i.override.mode === "manual" ? 1 : 0,
    valvePct: s.valve,
    // water
    q: s.q,
    qMeter: s.qMeter,
    flowPct: (s.q / DESIGN.flow) * 100,
    flowShare: s.q / DESIGN.flow,
    /** Pump head, ft, and across the valve and the strainer */
    head,
    headPsi: head * PSI_PER_FT,
    hValve,
    hStrainer,
    hSystem: Math.max(0, head - hValve),
    suction,
    discharge,
    // power
    kw,
    kwDesign,
    eff,
    /** Best efficiency flow at this speed, gpm */
    bepNow: spec.bep * n,
    kwThrottled: ways.throttled,
    kwSlowed: ways.slowed,
    /** Power the other way would take for this flow, kW */
    kwOther: i.method === "vfd" ? ways.throttled : ways.slowed,
    oversized: i.size === "oversized" ? 1 : 0,
    // temperatures (chilled water supply)
    chwTemp: 44,
    // faults
    reversed: i.faults.reversed ? 1 : 0,
    clog: i.faults.clog,
    short: s.qMeter < i.flowSp * 0.9 && (i.method === "vfd" ? s.speed > 99 : s.valve > 99) ? 1 : 0,
  };
}

export type PumpOutputs = ReturnType<typeof outputs>;

export const DEFAULT_INPUTS: PumpInputs = {
  method: "vfd",
  flowSp: 300,
  size: "right",
  override: { mode: "auto", value: 100 },
  faults: { reversed: false, clog: 0 },
};
