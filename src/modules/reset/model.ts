/**
 * Static pressure reset model: pure, deterministic, no rendering.
 *
 * One air handler's supply fan on a VFD feeds a supply main with four pressure-independent VAV boxes
 * off it, each serving its own zone. A static pressure sensor partway down the main tells the fan
 * loop how hard to run. The question is what that pressure setpoint should be.
 *
 * The same three layers as the other modules:
 *   command  — the setpoint (fixed, or reset by trim & respond), the fan loop, each box's room and
 *              airflow loops, an operator override on the fan at P8
 *   feedback — duct static reading, fan speed, each box's airflow reading and damper position, and the
 *              static pressure requests each box sends the air handler
 *   physical — the pressure at every takeoff, the airflow through every box, every room's temperature
 *
 * Trim & respond follows ASHRAE Guideline 36: every interval, if the requests (R) are no more than the
 * ignored requests (I), trim the setpoint; otherwise raise it by SPres·(R − I), at most SPres-max.
 * A box asks for more pressure the way Guideline 36's VAV sequence says: one request while its damper
 * is over 95 % open (held until it closes below 85 %), two when it's that open and still under 70 % of
 * its airflow setpoint for a minute, three under 50 %.
 */

export type ResetMode = "fixed" | "reset";
export type OverrideMode = "auto" | "manual";

export interface ZoneInputs {
  /** Heat gain in the zone (people, lights, sun), Btu/h */
  load: number;
  /** Importance multiplier on the zone's requests: 1 counts them, 0 ignores the zone */
  importance: number;
}

export interface ResetInputs {
  mode: ResetMode;
  /** The fixed setpoint, and the highest trim & respond may go (SPmax), in. w.c. */
  spMax: number;
  /** Trim & respond: ignored requests (I), trim per interval, respond per request, most per interval, in. w.c. */
  ignores: number;
  trim: number;
  respond: number;
  respondMax: number;
  /** Supply air temperature, °F, and the rooms' cooling setpoint */
  sat: number;
  zoneSp: number;
  zones: ZoneInputs[];
  /** Operator override on the fan speed, %, written at priority 8 */
  override: { mode: OverrideMode; value: number };
  faults: {
    /** The Offices box's damper linkage slipped: the blade stays at stuckAt % whatever the actuator does */
    slipped: boolean;
    stuckAt: number;
    /** The Corner office's flex duct crushed above the ceiling: its downstream resistance multiplied */
    crushed: boolean;
    /** Duct static sensor error, in. w.c., added to the reading */
    sensorOffset: number;
  };
}

export interface ZoneState {
  /** Room loop integral and output, % of the airflow range */
  zoneI: number;
  zoneOut: number;
  /** Airflow setpoint, cfm */
  flowSp: number;
  /** Airflow loop integral and output (the damper command), % */
  flowI: number;
  cmd: number;
  /** Actuator and blade positions, % */
  act: number;
  blade: number;
  /** True airflow and the box's (filtered) reading, cfm */
  q: number;
  qBas: number;
  /** Room air, and the thermostat's lagged reading, °F */
  zone: number;
  zoneSensor: number;
  /** Seconds the 3- and 2-request conditions have held; the 1-request latch */
  t3: number;
  t2: number;
  latch: boolean;
  /** Static pressure requests this box is sending now: 0–3 */
  req: number;
  /** Share of recent time spent sending any request (Guideline 36 keeps these as request-hours) */
  reqShare: number;
  /** Share of recent time starved: sending 2 or 3 requests */
  starvedShare: number;
}

/** One trim & respond decision, kept for the panel's staircase */
export interface ResetStep {
  t: number;
  sp: number;
  r: number;
  /** -1 trimmed, +1 responded, 0 fixed setpoint (no reset) */
  action: -1 | 0 | 1;
}

export interface ResetState {
  t: number;
  zones: ZoneState[];
  /** Static pressure setpoint, in. w.c. */
  sp: number;
  /** Seconds since the last trim & respond step */
  clock: number;
  /** Requests counted at the last step (after importance multipliers) */
  r: number;
  log: ResetStep[];
  /** Fan loop integral and output, % speed */
  fanI: number;
  fanOut: number;
  /** Speed command after priority arbitration, and the VFD's actual speed, % */
  fanCmd: number;
  speed: number;
  activePriority: 8 | 16;
  /** Controller's filtered duct static reading, in. w.c. */
  dspRead: number;
}

// ── the system ──────────────────────────────────────────────────────────────────

/**
 * The four zones, in order down the main. Each box's pressure drops are at its design (maximum)
 * airflow and scale with airflow²: dpOpen through the box wide open, dpDown through its discharge,
 * flex and diffuser. The corner office is the farthest out with the longest run downstream.
 */
export const ZONES = [
  { id: "z1", name: "Open office", short: "Open office", tag: "Open", design: 900, dpOpen: 0.15, dpDown: 0.25 },
  { id: "z2", name: "Offices", short: "Offices", tag: "Offices", design: 700, dpOpen: 0.15, dpDown: 0.25 },
  { id: "z3", name: "Conference room", short: "Conference", tag: "Conf", design: 1000, dpOpen: 0.18, dpDown: 0.3 },
  { id: "z4", name: "Corner office", short: "Corner", tag: "Corner", design: 900, dpOpen: 0.2, dpDown: 0.45 },
] as const;

export const SYSTEM = {
  /** Design airflow of the air handler, cfm */
  design: 3500,
  /** Filters, coils and casing inside the air handler, in. w.c. at design airflow */
  ahuDrop: 1.0,
  /**
   * The supply main, as pressure drops at a reference airflow: fan to the Open office takeoff, then on to
   * the Offices, to the static sensor, to the Conference room, to the Corner office.
   */
  mainDrops: [
    [0.2, 3500],
    [0.06, 2600],
    [0.05, 1900],
    [0.03, 1900],
    [0.06, 900],
  ] as [number, number][],
  /** Fan curve at full speed: shutoff static, and static at design airflow, in. w.c. */
  shutoff: 4.5,
  atDesign: 3.3,
  /** Fan, motor and drive together */
  efficiency: 0.55,
  /** Drive limits, % */
  minSpeed: 15,
  /** Box damper: leak + (1 − leak)·x^k */
  leak: 0.02,
  k: 2.5,
  /** Lowest the reset may go (Guideline 36 SPmin), in. w.c. */
  spMin: 0.1,
  /** Walls, floors and neighbors: heat flows in from about 76 °F, Btu/h·°F per zone */
  envelopeUA: 200,
  surroundF: 76,
  /** Minimum airflow, fraction of each box's design */
  minFrac: 0.2,
  /** How much the crushed flex multiplies the Corner office's downstream resistance */
  crushed: 2.5,
} as const;

/**
 * Time is compressed: Guideline 36 trims or responds every 2 minutes and wants a condition held for a
 * minute before a box sends 2 or 3 requests; here those are 10 s and 5 s. The boxes' actuators stroke in
 * 13 s like the VAV module's, and the rooms are slow, the way rooms are.
 */
export const PHYSICS = {
  period: 10,
  persist: 5,
  strokeTime: 13,
  deadband: 0.6,
  readTau: 0.6,
  dspTau: 0.3,
  zoneTau: 90,
  sensorTau: 3,
  zoneKp: 12,
  zoneTi: 90,
  flowKp: 1.6,
  flowTi: 4,
  /** Fan loop: % speed per in. w.c. of error, reset time s */
  fanKp: 30,
  fanTi: 2.5,
  /** VFD ramp, % speed per s */
  ramp: 12,
  /** Request-hours window, s */
  shareTau: 90,
  starvedTau: 40,
} as const;

/** Log length kept for the panel (about 6 minutes of steps) */
export const LOG_LENGTH = 36;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerpExp = (a: number, b: number, dt: number, tau: number) => a + (b - a) * (1 - Math.exp(-dt / tau));

const fanCurveC = (SYSTEM.shutoff - SYSTEM.atDesign) / SYSTEM.design ** 2;
const ahuR = SYSTEM.ahuDrop / SYSTEM.design ** 2;
const mainR = SYSTEM.mainDrops.map(([dp, q]) => dp / (q * q));

/** Inherent damper curve: flow fraction at constant pressure drop, x in 0–1 */
export function damperInherent(x: number) {
  return SYSTEM.leak + (1 - SYSTEM.leak) * Math.pow(clamp(x, 0, 1), SYSTEM.k);
}

function dpDownOf(k: number, i: ResetInputs) {
  return ZONES[k].dpDown * (k === 3 && i.faults.crushed ? SYSTEM.crushed : 1);
}

/** Airflow through box k (cfm) with its blade at x (0–1) and p in. w.c. at its takeoff */
export function boxFlow(k: number, x: number, p: number, i: ResetInputs) {
  const z = ZONES[k];
  const f = damperInherent(x);
  return z.design * Math.sqrt(Math.max(0, p) / (z.dpOpen / (f * f) + dpDownOf(k, i)));
}

/** Blade position (0–1) that passes airflow q at takeoff pressure p; 1 if even wide open can't */
export function positionFor(k: number, q: number, p: number, i: ResetInputs) {
  const z = ZONES[k];
  if (q <= 0) return 0;
  const r = (p * (z.design / q) ** 2 - dpDownOf(k, i)) / z.dpOpen;
  if (r <= 1) return 1;
  const f = 1 / Math.sqrt(r);
  if (f <= SYSTEM.leak) return 0;
  return clamp(Math.pow((f - SYSTEM.leak) / (1 - SYSTEM.leak), 1 / SYSTEM.k), 0, 1);
}

export interface Network {
  /** Airflow through each box, cfm */
  q: number[];
  /** Static at each box's takeoff, in. w.c. */
  taps: number[];
  /** Static at the sensor */
  sensor: number;
  /** Total airflow, cfm, and the fan's static rise, in. w.c. */
  total: number;
  fanStatic: number;
}

/** Pressures and airflows down the main, marching upstream from the Corner office's takeoff at pEnd */
function march(blades: number[], pEnd: number, i: ResetInputs) {
  const q = [0, 0, 0, 0];
  const taps = [0, 0, 0, 0];
  taps[3] = pEnd;
  q[3] = boxFlow(3, blades[3], pEnd, i);
  taps[2] = taps[3] + mainR[4] * q[3] ** 2;
  q[2] = boxFlow(2, blades[2], taps[2], i);
  const past = q[2] + q[3];
  const sensor = taps[2] + mainR[3] * past ** 2;
  taps[1] = sensor + mainR[2] * past ** 2;
  q[1] = boxFlow(1, blades[1], taps[1], i);
  taps[0] = taps[1] + mainR[1] * (q[1] + past) ** 2;
  q[0] = boxFlow(0, blades[0], taps[0], i);
  const total = q[0] + q[1] + past;
  const fanStatic = taps[0] + (mainR[0] + ahuR) * total ** 2;
  return { q, taps, sensor, total, fanStatic };
}

/** Where the fan curve at this speed (0–1) meets the system with the blades where they are */
export function solveNetwork(blades: number[], speed: number, i: ResetInputs): Network {
  let lo = 0;
  let hi: number = SYSTEM.shutoff;
  let m = march(blades, 0, i);
  if (speed <= 0) return m;
  for (let it = 0; it < 44; it++) {
    const mid = (lo + hi) / 2;
    m = march(blades, mid, i);
    const avail = SYSTEM.shutoff * speed * speed - fanCurveC * m.total ** 2;
    if (m.fanStatic > avail) hi = mid;
    else lo = mid;
  }
  return march(blades, (lo + hi) / 2, i);
}

/**
 * The pressures down the main when every box gets the airflow it wants and the sensor reads `sensor`:
 * what a settled system looks like at that setpoint.
 */
export function networkAt(flows: number[], sensor: number) {
  const past = flows[2] + flows[3];
  const taps = [0, 0, 0, 0];
  taps[2] = sensor - mainR[3] * past ** 2;
  taps[3] = taps[2] - mainR[4] * flows[3] ** 2;
  taps[1] = sensor + mainR[2] * past ** 2;
  taps[0] = taps[1] + mainR[1] * (flows[1] + past) ** 2;
  const total = flows[0] + flows[1] + past;
  return { taps, total, fanStatic: taps[0] + (mainR[0] + ahuR) * total ** 2 };
}

/** Fan speed (0–1) that makes `fanStatic` at `total` cfm */
export function speedFor(fanStatic: number, total: number) {
  return Math.sqrt(Math.max(0, fanStatic + fanCurveC * total * total) / SYSTEM.shutoff);
}

/** Fan electrical power, kW, moving `total` cfm against `fanStatic` in. w.c. */
export function fanKw(total: number, fanStatic: number) {
  return ((total * Math.max(0, fanStatic)) / (6356 * SYSTEM.efficiency)) * 0.746;
}

/** The airflow each zone needs to hold its setpoint against its load, cfm */
export function flowNeeded(k: number, i: ResetInputs, zone = i.zoneSp) {
  const z = ZONES[k];
  const heat = i.zones[k].load + SYSTEM.envelopeUA * (SYSTEM.surroundF - zone);
  return clamp(heat / (1.08 * Math.max(1, zone - i.sat)), SYSTEM.minFrac * z.design, z.design);
}

/**
 * The setpoint trim & respond settles around: the lowest static at which the neediest box (that counts)
 * is about 90 % open, halfway between where it starts and stops asking.
 */
export function settledSp(i: ResetInputs) {
  const flows = ZONES.map((_, k) => flowNeeded(k, i));
  const worst = (sp: number) => {
    const { taps } = networkAt(flows, sp);
    let w = 0;
    ZONES.forEach((_, k) => {
      if (i.zones[k].importance > 0) w = Math.max(w, positionFor(k, flows[k], taps[k], i));
    });
    return w;
  };
  let lo: number = SYSTEM.spMin;
  let hi = i.spMax;
  if (worst(hi) > 0.9) return hi;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (worst(mid) > 0.9) lo = mid;
    else hi = mid;
  }
  return hi;
}

// ── requests ─────────────────────────────────────────────────────────────────────

/** Guideline 36's static pressure reset requests from one box, updating its timers and latch */
function requests(z: ZoneState, dt: number) {
  const open = z.act > 95;
  const t3 = open && z.flowSp > 0 && z.qBas < 0.5 * z.flowSp ? z.t3 + dt : 0;
  const t2 = open && z.flowSp > 0 && z.qBas < 0.7 * z.flowSp ? z.t2 + dt : 0;
  const latch = z.act > 95 ? true : z.act < 85 ? false : z.latch;
  const req = t3 >= PHYSICS.persist ? 3 : t2 >= PHYSICS.persist ? 2 : latch ? 1 : 0;
  return { t3, t2, latch, req };
}

// ── dynamics ─────────────────────────────────────────────────────────────────────

const zoneCap = (k: number) => (PHYSICS.zoneTau * 1.08 * 0.4 * ZONES[k].design) / 3600;

export function init(inputs: ResetInputs, seed: Partial<ResetState> = {}): ResetState {
  const sp = seed.sp ?? (inputs.mode === "fixed" ? inputs.spMax : settledSp(inputs));
  const flows = ZONES.map((_, k) => flowNeeded(k, inputs));
  const net = networkAt(flows, sp);
  const zones: ZoneState[] = ZONES.map((z, k) => {
    let pos = positionFor(k, flows[k], net.taps[k], inputs) * 100;
    if (k === 1 && inputs.faults.slipped) pos = 100;
    const blade = k === 1 && inputs.faults.slipped ? inputs.faults.stuckAt : pos;
    const q = boxFlow(k, blade / 100, net.taps[k], inputs);
    const zoneOut = (100 * (flows[k] - SYSTEM.minFrac * z.design)) / ((1 - SYSTEM.minFrac) * z.design);
    const latch = pos > 90;
    return {
      zoneI: zoneOut,
      zoneOut,
      flowSp: flows[k],
      flowI: pos,
      cmd: pos,
      act: pos,
      blade,
      q,
      qBas: q,
      zone: inputs.zoneSp,
      zoneSensor: inputs.zoneSp,
      t3: 0,
      t2: 0,
      latch,
      req: latch ? 1 : 0,
      reqShare: latch ? 0.5 : 0,
      starvedShare: 0,
    };
  });
  const speed = speedFor(net.fanStatic, net.total) * 100;
  const manual = inputs.override.mode === "manual";
  return {
    t: 0,
    zones,
    sp,
    clock: 0,
    r: 0,
    log: [],
    fanI: speed,
    fanOut: speed,
    fanCmd: manual ? inputs.override.value : speed,
    speed: manual ? inputs.override.value : speed,
    activePriority: manual ? 8 : 16,
    dspRead: sp + inputs.faults.sensorOffset,
    ...seed,
  };
}

export function step(s: ResetState, i: ResetInputs, dt: number): ResetState {
  const t = s.t + dt;

  // ── each box: room loop → airflow setpoint → airflow loop → actuator → blade ──
  const moved = s.zones.map((z, k) => {
    const d = ZONES[k];
    const zErr = z.zoneSensor - i.zoneSp;
    const zP = PHYSICS.zoneKp * zErr;
    const zoneI = clamp(z.zoneI + (PHYSICS.zoneKp / PHYSICS.zoneTi) * zErr * dt, -zP, 100 - zP);
    const zoneOut = clamp(zP + zoneI, 0, 100);
    const lo = SYSTEM.minFrac * d.design;
    const flowSp = lo + (zoneOut / 100) * (d.design - lo);
    const err = ((flowSp - z.qBas) / d.design) * 100;
    const p = PHYSICS.flowKp * err;
    const flowI = clamp(z.flowI + (PHYSICS.flowKp / PHYSICS.flowTi) * err * dt, -p, 100 - p);
    const cmd = clamp(p + flowI, 0, 100);
    // floating actuator: moves at stroke speed outside its deadband, overdrives to the stops
    let act = z.act;
    const target = cmd >= 99.5 ? 100 : cmd <= 0.5 ? 0 : cmd;
    const gap = target - act;
    if (Math.abs(gap) > PHYSICS.deadband || ((target === 100 || target === 0) && gap !== 0)) {
      const maxMove = (100 / PHYSICS.strokeTime) * dt;
      act = act + clamp(gap, -maxMove, maxMove);
    }
    const blade = k === 1 && i.faults.slipped ? clamp(i.faults.stuckAt, 0, 100) : clamp(act, 0, 100);
    return { ...z, zoneI, zoneOut, flowSp, flowI, cmd, act, blade };
  });

  // ── trim & respond, every period ──
  let sp = s.sp;
  let clock = s.clock + dt;
  let r = s.r;
  let log = s.log;
  if (i.mode === "fixed") {
    sp = i.spMax;
  } else {
    sp = clamp(sp, SYSTEM.spMin, i.spMax);
  }
  if (clock >= PHYSICS.period) {
    clock -= PHYSICS.period;
    r = s.zones.reduce((n, z, k) => n + z.req * i.zones[k].importance, 0);
    let action: ResetStep["action"] = 0;
    if (i.mode === "reset") {
      if (r <= i.ignores) {
        sp = Math.max(SYSTEM.spMin, sp - i.trim);
        action = -1;
      } else {
        sp = Math.min(i.spMax, sp + Math.min(i.respondMax, i.respond * (r - i.ignores)));
        action = 1;
      }
    }
    log = [...log, { t, sp, r, action }];
    if (log.length > LOG_LENGTH) log = log.slice(log.length - LOG_LENGTH);
  }

  // ── fan loop: speed to hold the duct static at the setpoint; operator @8 beats program @16 ──
  const fErr = sp - s.dspRead;
  const fP = PHYSICS.fanKp * fErr;
  const fanI = clamp(s.fanI + (PHYSICS.fanKp / PHYSICS.fanTi) * fErr * dt, SYSTEM.minSpeed - fP, 100 - fP);
  const fanOut = clamp(fP + fanI, SYSTEM.minSpeed, 100);
  const manual = i.override.mode === "manual";
  const fanCmd = manual ? clamp(i.override.value, 0, 100) : fanOut;
  const speed = s.speed + clamp(fanCmd - s.speed, -PHYSICS.ramp * dt, PHYSICS.ramp * dt);

  // ── the air: where the fan curve meets the system ──
  const net = solveNetwork(
    moved.map((z) => z.blade / 100),
    speed / 100,
    i,
  );
  const dspRead = lerpExp(s.dspRead, net.sensor + i.faults.sensorOffset, dt, PHYSICS.dspTau);

  const zones = moved.map((z, k) => {
    const q = net.q[k];
    const qBas = lerpExp(z.qBas, q, dt, PHYSICS.readTau);
    const heat = i.zones[k].load + SYSTEM.envelopeUA * (SYSTEM.surroundF - z.zone);
    const zone = z.zone + ((heat - 1.08 * q * (z.zone - i.sat)) / (zoneCap(k) * 3600)) * dt;
    const zoneSensor = lerpExp(z.zoneSensor, zone, dt, PHYSICS.sensorTau);
    const next = { ...z, q, qBas, zone, zoneSensor };
    const rq = requests(next, dt);
    return {
      ...next,
      ...rq,
      reqShare: lerpExp(z.reqShare, rq.req > 0 ? 1 : 0, dt, PHYSICS.shareTau),
      starvedShare: lerpExp(z.starvedShare, rq.req >= 2 ? 1 : 0, dt, PHYSICS.starvedTau),
    };
  });

  return {
    t,
    zones,
    sp,
    clock,
    r,
    log,
    fanI,
    fanOut,
    fanCmd,
    speed,
    activePriority: manual ? 8 : 16,
    dspRead,
  };
}

// ── outputs ──────────────────────────────────────────────────────────────────────

type ZoneKey =
  | "damper"
  | "actuator"
  | "dmp"
  | "act"
  | "cmd"
  | "q"
  | "qBas"
  | "flowSp"
  | "maxFlow"
  | "zone"
  | "zoneSensor"
  | "req"
  | "counted"
  | "importance"
  | "share"
  | "rogue"
  | "tap"
  | "burned";
export type ZoneOutputs = { [K in ZoneKey as `${K}${1 | 2 | 3 | 4}`]: number };

/** Read a per-zone output by zone index 0–3 */
export const zo = (o: ResetOutputs, key: ZoneKey, k: number) => o[`${key}${k + 1}` as keyof ZoneOutputs];

export function outputs(s: ResetState, i: ResetInputs) {
  const net = solveNetwork(
    s.zones.map((z) => z.blade / 100),
    s.speed / 100,
    i,
  );
  const kw = fanKw(net.total, net.fanStatic);
  // what the fan would draw holding the same airflows at a fixed setpoint of spMax
  const fixed = networkAt(net.q, i.spMax);
  const kwFixed = fanKw(fixed.total, fixed.fanStatic);
  const atMax = s.sp >= i.spMax - 0.011;

  const perZone = {} as ZoneOutputs;
  let worst = 0;
  s.zones.forEach((z, k) => {
    const n = k + 1;
    const set = (key: ZoneKey, v: number) => ((perZone as Record<string, number>)[`${key}${n}`] = v);
    set("damper", z.blade / 100);
    set("actuator", z.act / 100);
    set("dmp", z.blade);
    set("act", z.act);
    set("cmd", z.cmd);
    set("q", z.q);
    set("qBas", z.qBas);
    set("flowSp", z.flowSp);
    set("maxFlow", ZONES[k].design);
    set("zone", z.zone);
    set("zoneSensor", z.zoneSensor);
    set("req", z.req);
    set("counted", z.req * i.zones[k].importance);
    set("importance", i.zones[k].importance);
    set("share", z.reqShare);
    // a rogue: starved most of the time, counted, and holding the setpoint at the top of its range
    set("rogue", i.mode === "reset" && i.zones[k].importance > 0 && z.starvedShare > 0.75 && atMax ? 1 : 0);
    set("tap", net.taps[k]);
    const down = (ZONES[k].dpDown * (k === 3 && i.faults.crushed ? SYSTEM.crushed : 1) + ZONES[k].dpOpen) * (z.q / ZONES[k].design) ** 2;
    set("burned", Math.max(0, net.taps[k] - down));
    if (i.zones[k].importance > 0) worst = Math.max(worst, z.act);
  });
  const counted = s.zones.reduce((n, z, k) => n + z.req * i.zones[k].importance, 0);
  const burned = s.zones.reduce((a, _, k) => a + (perZone as Record<string, number>)[`burned${k + 1}`], 0) / 4;

  return {
    // GLB drives (0–1)
    fanSpeed: s.speed / 100,
    ...perZone,
    // the setpoint and the reset
    reset: i.mode === "reset" ? 1 : 0,
    sp: s.sp,
    spMax: i.spMax,
    spMin: SYSTEM.spMin,
    ignores: i.ignores,
    trim: i.trim,
    respond: i.respond,
    respondMax: i.respondMax,
    /** Requests counted right now, and at the last step */
    requests: counted,
    lastR: s.r,
    lastAction: s.log.length ? s.log[s.log.length - 1].action : 0,
    /** What the next step will do with today's requests: -1 trim, +1 respond, 0 nothing */
    nextAction: i.mode !== "reset" ? 0 : counted <= i.ignores ? (s.sp <= SYSTEM.spMin + 1e-6 ? 0 : -1) : s.sp >= i.spMax - 1e-6 ? 0 : 1,
    nextIn: Math.max(0, PHYSICS.period - s.clock),
    atMax: atMax ? 1 : 0,
    /** The most-open damper among the zones that count, % */
    mostOpen: worst,
    // the fan
    fanCmd: s.fanCmd,
    fanLoop: s.fanOut,
    fanPct: s.speed,
    fanHz: (s.speed / 100) * 60,
    activePriority: s.activePriority,
    manual: i.override.mode === "manual" ? 1 : 0,
    kw,
    kwFixed,
    /** Fan power saved against holding the fixed setpoint, % */
    savedPct: kwFixed > 1e-6 ? (1 - kw / kwFixed) * 100 : 0,
    fanStatic: net.fanStatic,
    // the duct
    dsp: s.dspRead,
    dspTrue: net.sensor,
    total: net.total,
    airFlow: net.total / SYSTEM.design,
    /** Average pressure the dampers burn off holding their airflows down, in. w.c. */
    burned,
    sat: i.sat,
    zoneSp: i.zoneSp,
    // faults
    slipped: i.faults.slipped ? 1 : 0,
    crushed: i.faults.crushed ? 1 : 0,
    sensorOffset: i.faults.sensorOffset,
  };
}

export type ResetOutputs = ReturnType<typeof outputs>;

export const DEFAULT_INPUTS: ResetInputs = {
  mode: "reset",
  spMax: 1.5,
  ignores: 0,
  trim: 0.05,
  respond: 0.06,
  respondMax: 0.13,
  sat: 55,
  zoneSp: 74,
  zones: [
    { load: 7000, importance: 1 },
    { load: 5000, importance: 1 },
    { load: 6000, importance: 1 },
    { load: 12000, importance: 1 },
  ],
  override: { mode: "auto", value: 60 },
  faults: { slipped: false, stuckAt: 25, crushed: false, sensorOffset: 0 },
};
