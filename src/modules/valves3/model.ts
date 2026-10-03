/**
 * Three-way vs. two-way valves: pure, deterministic, no rendering.
 *
 * A chilled-water loop: a pump on a VFD, supply and return mains along the wall, three cooling coils
 * off them. Each coil's control valve is a three-way mixing valve on its return with a bypass from its
 * supply. Close the bypass's balancing valve and it works as a two-way valve: that's how a lot of
 * buildings get converted, one coil at a time.
 *
 * The same three layers as the other modules:
 *   command  — each coil's loop opening its valve until the coil delivers its load; the pump's loop
 *              holding the differential pressure at the far coil; Hand on the drive at priority 8
 *   feedback — valve positions, the DP sensor, the loop's flow meter, supply and return temperatures,
 *              the drive's speed and kW
 *   physical — the flow through each coil and each bypass, each coil's leaving water, the mixed return
 *
 * A three-way branch is a constant resistance whose flow the valve splits between the coil and the
 * bypass (a balanced bypass, as designed); a two-way branch is the coil and its valve in series.
 */

export type ValveKind = "three" | "two";
export type OverrideMode = "auto" | "manual";

export interface ValveInputs {
  /** Each coil's valve: three-way (bypass open) or working as a two-way (bypass shut) */
  kinds: ValveKind[];
  /** The building's cooling load, % of design; each coil carries its share */
  load: number;
  /** Pump DP setpoint across the far coil, ft */
  dpSp: number;
  /** Drive speed override (Hand), %, priority 8 */
  override: { mode: OverrideMode; value: number };
  faults: {
    /** Coil 1's bypass balancing valve left wide open */
    bypassOpen: boolean;
  };
}

export interface CoilState {
  /** Valve loop integral and output, % */
  loopI: number;
  cmd: number;
  /** Valve position, % (coil port open) */
  valve: number;
}

export interface ValveState {
  t: number;
  coils: CoilState[];
  /** Pump loop integral and output, % speed */
  pumpI: number;
  pumpOut: number;
  speedCmd: number;
  speed: number;
  activePriority: 8 | 16;
  /** Branch flows, gpm (lagged), and the DP sensor's reading, ft */
  q: number[];
  dpRead: number;
}

// ── the loop ────────────────────────────────────────────────────────────────────

/** Each coil: 100 gpm and 50 tons at design (44 °F in, 56 °F out) */
export const COIL = { flow: 100, dT: 12, supply: 44, airIn: 80 } as const;
/** Each coil's share of the building load */
export const SHARES = [1.0, 0.85, 0.95];
export const DESIGN_FLOW = 300;

export const LOOP = {
  /** Chiller evaporator and plant piping, ft at design flow */
  plant: 20,
  /** Supply-and-return mains between the pump and coil 1, coil 1 and 2, coil 2 and 3: ft at the flow each carries at design */
  mains: [
    [3, 300],
    [3, 200],
    [3, 100],
  ] as [number, number][],
  /** Each coil, and its control valve wide open, ft at 100 gpm */
  coil: 12,
  valve: 6,
  /** Two-way valve characteristic: equal percentage, R = 30; shut below 2 % */
  rangeability: 30,
  /** The bypass balancing valve wide open: the bypass path takes this share of the coil's resistance */
  bypassOpen: 0.12,
  /** The chiller won't run below this flow, gpm (35 % of design) */
  chillerMin: 105,
} as const;

export const PUMP = { h0: 88, qMax: 545, bep: 340, etaMax: 0.75 } as const;

export const PHYSICS = {
  flowTau: 1.0,
  dpTau: 0.4,
  /** Coil loops: % per % of load error, reset s; actuator stroke s */
  coilKp: 0.8,
  coilTi: 6,
  stroke: 20,
  /** Pump loop: % speed per ft of DP error, reset s */
  pumpKp: 2.5,
  pumpTi: 2.5,
  ramp: 12,
  minSpeed: 25,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sq = (x: number) => x * x;

/** Coil capacity (fraction of design) at water-flow fraction φ: half the water does most of the work,
 *  and the water can't leave warmer than a few degrees under the air coming in */
export function coilCapacity(phi: number) {
  const f = Math.max(0, phi);
  const curve = (f * 1.8) / (f + 0.8);
  const waterLimit = (f * (COIL.airIn - 3 - COIL.supply)) / COIL.dT;
  return Math.min(curve, waterLimit);
}

/** Water-flow fraction a coil needs to deliver capacity c */
export function flowNeeded(c: number) {
  const L = clamp(c, 0, 1);
  return Math.max((0.8 * L) / (1.8 - L), (L * COIL.dT) / (COIL.airIn - 3 - COIL.supply));
}

function eqPct(x: number) {
  return x < 0.02 ? 0.003 : Math.pow(LOOP.rangeability, clamp(x, 0, 1) - 1);
}

/** Branch resistance K (ft per gpm²) for a coil with its valve at x */
export function branchK(k: number, x: number, i: ValveInputs) {
  const kc = LOOP.coil / sq(COIL.flow);
  const kv = LOOP.valve / sq(COIL.flow);
  if (i.kinds[k] === "two") return kc + kv / sq(eqPct(x));
  // three-way: constant resistance when the bypass is balanced; with it wide open, the bypass side is easier
  const kb = k === 0 && i.faults.bypassOpen ? kc * LOOP.bypassOpen : kc;
  const s = clamp(x, 0, 1);
  return kv + s * kc + (1 - s) * kb;
}

const mainK = LOOP.mains.map(([dp, q]) => dp / (q * q));
const plantK = LOOP.plant / sq(DESIGN_FLOW);
const pumpC = PUMP.h0 / sq(PUMP.qMax);

export interface Net {
  q: number[];
  /** DP across each branch, ft */
  dp: number[];
  total: number;
  head: number;
}

function march(dpEnd: number, valves: number[], i: ValveInputs): Net {
  const q = [0, 0, 0];
  const dp = [0, 0, 0];
  dp[2] = dpEnd;
  q[2] = Math.sqrt(dp[2] / branchK(2, valves[2], i));
  dp[1] = dp[2] + mainK[2] * sq(q[2]);
  q[1] = Math.sqrt(dp[1] / branchK(1, valves[1], i));
  dp[0] = dp[1] + mainK[1] * sq(q[1] + q[2]);
  q[0] = Math.sqrt(dp[0] / branchK(0, valves[0], i));
  const total = q[0] + q[1] + q[2];
  return { q, dp, total, head: dp[0] + (mainK[0] + plantK) * sq(total) };
}

/** Where the pump at speed n meets the loop with the valves where they are */
export function solve(n: number, valves: number[], i: ValveInputs): Net {
  let lo = 0;
  let hi: number = PUMP.h0;
  for (let it = 0; it < 44; it++) {
    const mid = (lo + hi) / 2;
    const m = march(mid, valves, i);
    if (m.head > n * n * PUMP.h0 - pumpC * sq(m.total)) hi = mid;
    else lo = mid;
  }
  return march((lo + hi) / 2, valves, i);
}

/** Split of a branch's flow: through the coil, around it */
export function split(k: number, x: number, qBranch: number, i: ValveInputs) {
  if (i.kinds[k] === "two") return { coil: qBranch, bypass: 0 };
  const s = clamp(x, 0, 1);
  return { coil: qBranch * s, bypass: qBranch * (1 - s) };
}

export function pumpKw(q: number, h: number, n: number) {
  const eff = n < 0.05 ? 0.1 : PUMP.etaMax * clamp(1 - sq(q / n / PUMP.bep - 1), 0.08, 1);
  const drive = 0.92 - 0.12 * sq(1 - clamp(n, 0, 1));
  const floor = 0.35 * ((PUMP.bep * (PUMP.h0 - pumpC * sq(PUMP.bep))) / 3960 / PUMP.etaMax) * n * n * n;
  return (Math.max((Math.max(0, q) * Math.max(0, h)) / 3960 / eff, floor) * 0.746) / drive;
}

// ── dynamics ─────────────────────────────────────────────────────────────────────

/** Each coil's load, fraction of its design */
export const coilLoad = (k: number, i: ValveInputs) => clamp((i.load / 100) * SHARES[k], 0, 1);

/** A settled starting point: valves where the loads need them, the pump where the DP needs it */
export function init(inputs: ValveInputs, seed: Partial<ValveState> = {}): ValveState {
  // iterate the coil loops and the pump loop to a steady state quietly
  let s: ValveState = {
    t: 0,
    coils: [0, 1, 2].map(() => ({ loopI: 50, cmd: 50, valve: 50 })),
    pumpI: 80,
    pumpOut: 80,
    speedCmd: 80,
    speed: 80,
    activePriority: 16,
    q: [100, 100, 100],
    dpRead: inputs.dpSp,
  };
  for (let k = 0; k < 3000; k++) s = step(s, inputs, 0.1);
  return { ...s, t: 0, ...seed };
}

export function step(s: ValveState, i: ValveInputs, dt: number): ValveState {
  const t = s.t + dt;
  // ── each coil: open the valve until the coil delivers its load ──
  const coils = s.coils.map((c, k) => {
    const sp = split(k, c.valve / 100, s.q[k], i);
    const delivered = coilCapacity(sp.coil / COIL.flow);
    const err = (coilLoad(k, i) - delivered) * 100;
    const p = PHYSICS.coilKp * err;
    const loopI = clamp(c.loopI + (PHYSICS.coilKp / PHYSICS.coilTi) * err * dt, -p, 100 - p);
    const cmd = clamp(p + loopI, 0, 100);
    const valve = c.valve + clamp(cmd - c.valve, (-100 / PHYSICS.stroke) * dt, (100 / PHYSICS.stroke) * dt);
    return { loopI, cmd, valve };
  });

  // ── the pump: hold the DP at the far coil; Hand at priority 8 beats it ──
  const err = i.dpSp - s.dpRead;
  const p = PHYSICS.pumpKp * err;
  const pumpI = clamp(s.pumpI + (PHYSICS.pumpKp / PHYSICS.pumpTi) * err * dt, PHYSICS.minSpeed - p, 100 - p);
  const pumpOut = clamp(p + pumpI, PHYSICS.minSpeed, 100);
  const manual = i.override.mode === "manual";
  const speedCmd = manual ? clamp(i.override.value, 0, 100) : pumpOut;
  const speed = s.speed + clamp(speedCmd - s.speed, -PHYSICS.ramp * dt, PHYSICS.ramp * dt);

  // ── the water ──
  const net = solve(
    speed / 100,
    coils.map((c) => c.valve / 100),
    i,
  );
  const a = 1 - Math.exp(-dt / PHYSICS.flowTau);
  const q = s.q.map((v, k) => v + (net.q[k] - v) * a);
  // the DP sensor across the far coil sees that branch's flow through its resistance
  const dpNow = branchK(2, coils[2].valve / 100, i) * sq(q[2]);
  const dpRead = s.dpRead + (dpNow - s.dpRead) * (1 - Math.exp(-dt / PHYSICS.dpTau));

  return { t, coils, pumpI, pumpOut, speedCmd, speed, activePriority: manual ? 8 : 16, q, dpRead };
}

// ── outputs ──────────────────────────────────────────────────────────────────────

type CoilKey = "valve" | "valvePos" | "coilQ" | "bypassQ" | "branchQ" | "lwt" | "branchT" | "load" | "delivered" | "three" | "bypassRate" | "coilRate";
export type CoilOutputs = { [K in CoilKey as `${K}${1 | 2 | 3}`]: number };
export const co = (o: ValveOutputs, key: CoilKey, k: number) => o[`${key}${k + 1}` as keyof CoilOutputs];

export function outputs(s: ValveState, i: ValveInputs) {
  const n = s.speed / 100;
  const total = s.q[0] + s.q[1] + s.q[2];
  const net = solve(
    n,
    s.coils.map((c) => c.valve / 100),
    i,
  );
  const per = {} as CoilOutputs;
  const set = (key: CoilKey, k: number, v: number) => ((per as Record<string, number>)[`${key}${k + 1}`] = v);
  let heat = 0;
  let returnSum = 0;
  s.coils.forEach((c, k) => {
    const sp = split(k, c.valve / 100, s.q[k], i);
    const phi = sp.coil / COIL.flow;
    const cap = coilCapacity(phi);
    const lwt = phi > 0.002 ? COIL.supply + (cap * COIL.dT) / phi : COIL.airIn - 3;
    const branchT = s.q[k] > 0.01 ? (sp.coil * lwt + sp.bypass * COIL.supply) / s.q[k] : COIL.supply;
    heat += cap;
    returnSum += s.q[k] * branchT;
    set("valve", k, c.valve);
    set("valvePos", k, c.valve / 100);
    set("coilQ", k, sp.coil);
    set("bypassQ", k, sp.bypass);
    set("branchQ", k, s.q[k]);
    set("lwt", k, lwt);
    set("branchT", k, branchT);
    set("load", k, coilLoad(k, i) * 100);
    set("delivered", k, cap * 100);
    set("three", k, i.kinds[k] === "three" ? 1 : 0);
    set("coilRate", k, sp.coil / COIL.flow);
    set("bypassRate", k, sp.bypass / COIL.flow);
  });
  const returnT = total > 0.01 ? returnSum / total : COIL.supply;
  const kw = pumpKw(total, Math.max(0, net.head), n);
  return {
    pumpSpeed: n,
    ...per,
    speedPct: s.speed,
    hz: n * 60,
    speedCmd: s.speedCmd,
    pumpLoop: s.pumpOut,
    activePriority: s.activePriority,
    manual: i.override.mode === "manual" ? 1 : 0,
    dp: s.dpRead,
    dpSp: i.dpSp,
    total,
    flowShare: total / DESIGN_FLOW,
    head: net.head,
    kw,
    supplyT: COIL.supply,
    returnT,
    deltaT: returnT - COIL.supply,
    /** Cooling the coils deliver, tons */
    tons: (heat * 500 * COIL.flow * COIL.dT) / 12000,
    load: i.load,
    lowFlow: total < LOOP.chillerMin ? 1 : 0,
    chillerMin: LOOP.chillerMin,
    threeWays: i.kinds.filter((k) => k === "three").length,
    bypassOpen: i.faults.bypassOpen ? 1 : 0,
  };
}

export type ValveOutputs = ReturnType<typeof outputs>;

export const DEFAULT_INPUTS: ValveInputs = {
  kinds: ["three", "three", "three"],
  load: 65,
  dpSp: 18,
  override: { mode: "auto", value: 100 },
  faults: { bypassOpen: false },
};
