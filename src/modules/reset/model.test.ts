import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUTS,
  PHYSICS,
  SYSTEM,
  ZONES,
  boxFlow,
  fanKw,
  init,
  networkAt,
  outputs,
  positionFor,
  settledSp,
  solveNetwork,
  speedFor,
  step,
  zo,
  type ResetInputs,
  type ResetOutputs,
  type ResetState,
} from "./model";
import { presets } from "./presets";

const DT = 0.05;

function run(inputs: ResetInputs, seconds: number, seed: Partial<ResetState> = {}) {
  let s = init(inputs, seed);
  const outs: ResetOutputs[] = [];
  for (let k = 0; k * DT < seconds; k++) {
    s = step(s, inputs, DT);
    if (k % 10 === 0) outs.push(outputs(s, inputs));
  }
  return { final: s, outs, out: outputs(s, inputs) };
}
/** Samples (every 0.5 s) over the last `seconds` */
const tail = <T,>(a: T[], seconds: number) => a.slice(-Math.round(seconds / 0.5));
const range = (a: number[]) => [Math.min(...a), Math.max(...a)];
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const preset = (id: string) => presets.find((p) => p.id === id)!;
const runPreset = (id: string, seconds: number) => run(preset(id).inputs, seconds, preset(id).seed);

describe("the duct system", () => {
  const i = DEFAULT_INPUTS;

  it("each box gives more air the further it opens and the harder it's pushed", () => {
    for (let k = 0; k < 4; k++) {
      let prev = 0;
      for (let x = 0; x <= 1.0001; x += 0.05) {
        const q = boxFlow(k, x, 0.5, i);
        expect(q).toBeGreaterThanOrEqual(prev);
        prev = q;
      }
      // wide open at dpOpen + dpDown: exactly its design airflow
      expect(boxFlow(k, 1, ZONES[k].dpOpen + ZONES[k].dpDown, i)).toBeCloseTo(ZONES[k].design, 6);
      expect(boxFlow(k, positionFor(k, 300, 0.6, i), 0.6, i)).toBeCloseTo(300, 3);
    }
  });

  it("the fan curve and the system meet where the pressures add up", () => {
    const blades = [0.5, 0.5, 0.5, 0.9];
    const net = solveNetwork(blades, 0.5, i);
    const avail = SYSTEM.shutoff * 0.25 - ((SYSTEM.shutoff - SYSTEM.atDesign) / SYSTEM.design ** 2) * net.total ** 2;
    expect(net.fanStatic).toBeCloseTo(avail, 3);
    // static falls down the main: the first takeoff sees the most, the last the least
    expect(net.taps[0]).toBeGreaterThan(net.taps[1]);
    expect(net.taps[1]).toBeGreaterThan(net.sensor);
    expect(net.sensor).toBeGreaterThan(net.taps[2]);
    expect(net.taps[2]).toBeGreaterThan(net.taps[3]);
    // faster fan, more pressure and more air
    const fast = solveNetwork(blades, 0.7, i);
    expect(fast.sensor).toBeGreaterThan(net.sensor);
    expect(fast.total).toBeGreaterThan(net.total);
  });

  it("speedFor and networkAt agree with the solver", () => {
    const flows = [350, 260, 310, 600];
    const at = networkAt(flows, 0.6);
    const n = speedFor(at.fanStatic, at.total);
    const blades = flows.map((q, k) => positionFor(k, q, at.taps[k], i));
    const net = solveNetwork(blades, n, i);
    expect(net.sensor).toBeCloseTo(0.6, 2);
    net.q.forEach((q, k) => expect(q).toBeCloseTo(flows[k], 0));
  });

  it("fan power is airflow times pressure", () => {
    expect(fanKw(2000, 2)).toBeCloseTo((2000 * 2) / 6356 / SYSTEM.efficiency * 0.746, 6);
    expect(fanKw(2000, 1)).toBeCloseTo(fanKw(2000, 2) / 2, 6);
  });
});

describe("trim & respond", () => {
  it("settles with the neediest box about 90 % open", () => {
    const sp = settledSp(DEFAULT_INPUTS);
    expect(sp).toBeGreaterThan(0.3);
    expect(sp).toBeLessThan(0.45);
  });

  it("trims every period when nobody asks, never below the minimum", () => {
    // light loads: every box well under 95 % even at the bottom of the range
    const light = { ...DEFAULT_INPUTS, zones: DEFAULT_INPUTS.zones.map((z) => ({ ...z, load: 2500 })) };
    const { final } = run(light, 200, { sp: 1.0 });
    expect(final.log.length).toBeGreaterThan(15);
    for (const e of final.log) expect(e.action === -1 || e.sp === SYSTEM.spMin).toBe(true);
    expect(final.sp).toBe(SYSTEM.spMin);
  });

  it("responds by SPres per request over the ignores, at most SPres-max", () => {
    const i = { ...DEFAULT_INPUTS, ignores: 1, respond: 0.06, respondMax: 0.13 };
    let s = init(i, { sp: 0.5 });
    // three boxes asking once each: R − I = 2 → +0.12; four: R − I = 3 → capped at +0.13
    s = { ...s, zones: s.zones.map((z, k) => ({ ...z, req: k < 3 ? 1 : 0 })), clock: PHYSICS.period - DT / 2 };
    const a = step(s, i, DT);
    expect(a.sp - 0.5).toBeCloseTo(0.12, 6);
    const b = step({ ...s, zones: s.zones.map((z) => ({ ...z, req: 1 })) }, i, DT);
    expect(b.sp - 0.5).toBeCloseTo(0.13, 6);
  });

  it("a box asks once over 95 % open and keeps asking until it closes below 85 %", () => {
    const i = DEFAULT_INPUTS;
    const s = init(i);
    const z = s.zones[0];
    const at = (act: number, latch: boolean) => step({ ...s, zones: s.zones.map((x, k) => (k === 0 ? { ...z, act, latch } : x)) }, i, DT).zones[0];
    expect(at(96, false).req).toBe(1);
    expect(at(90, true).req).toBe(1);
    expect(at(90, false).req).toBe(0);
  });

  it("importance 0 takes a zone's requests out of the count", () => {
    const i = { ...DEFAULT_INPUTS, zones: DEFAULT_INPUTS.zones.map((z, k) => (k === 3 ? { ...z, importance: 0 } : z)) };
    const s = init(i);
    const asking = { ...s, zones: s.zones.map((z, k) => ({ ...z, req: k === 3 ? 3 : 0 })) };
    expect(outputs(asking, i).requests).toBe(0);
    expect(outputs(asking, DEFAULT_INPUTS).requests).toBe(3);
  });

  it("the fan holds the duct static at the setpoint", () => {
    const { outs } = run({ ...DEFAULT_INPUTS, mode: "fixed", spMax: 1.0 }, 60);
    for (const o of tail(outs, 20)) expect(Math.abs(o.dsp - 1.0)).toBeLessThan(0.01);
  });

  it("manual fan speed writes at priority 8; the static goes where the fan puts it", () => {
    const { final, out } = run({ ...DEFAULT_INPUTS, override: { mode: "manual", value: 100 } }, 30);
    expect(final.activePriority).toBe(8);
    expect(out.fanPct).toBeCloseTo(100, 3);
    expect(out.dsp).toBeGreaterThan(2);
  });

  it("a sensor reading low makes the fan push harder than the setpoint", () => {
    const { outs } = run({ ...DEFAULT_INPUTS, mode: "fixed", spMax: 1.0, faults: { ...DEFAULT_INPUTS.faults, sensorOffset: -0.2 } }, 60);
    const o = outs[outs.length - 1];
    expect(o.dsp).toBeCloseTo(1.0, 1);
    expect(o.dspTrue).toBeCloseTo(1.2, 1);
  });
});

describe("presets", () => {
  it("all run finite and in range", () => {
    for (const p of presets) {
      const { outs } = run(p.inputs, 90, p.seed);
      for (const o of outs) {
        expect(Number.isFinite(o.kw) && Number.isFinite(o.sp) && Number.isFinite(o.dsp)).toBe(true);
        for (let k = 0; k < 4; k++) {
          expect(zo(o, "dmp", k)).toBeGreaterThanOrEqual(0);
          expect(zo(o, "dmp", k)).toBeLessThanOrEqual(100);
          expect(Number.isFinite(zo(o, "zone", k))).toBe(true);
        }
      }
    }
  });

  it("fixed: every box throttling 38–58 %, fan at 40 Hz", () => {
    const { out } = runPreset("fixed", 60);
    const dmp = [0, 1, 2, 3].map((k) => zo(out, "dmp", k));
    expect(Math.min(...dmp)).toBeGreaterThan(36);
    expect(Math.max(...dmp)).toBeLessThan(60);
    expect(Math.round(out.fanHz)).toBe(40);
    expect(out.savedPct).toBeCloseTo(0, 0);
  });

  it("reset: saws between about 0.3 and 0.5 in., about 27 Hz, about 60 % less fan power", () => {
    const { outs } = runPreset("reset", 300);
    const t = tail(outs, 200);
    const [lo, hi] = range(t.map((o) => o.sp));
    expect(lo).toBeGreaterThan(0.27);
    expect(lo).toBeLessThan(0.36);
    expect(hi).toBeGreaterThan(0.44);
    expect(hi).toBeLessThan(0.55);
    expect(Math.abs(mean(t.map((o) => o.fanHz)) - 27)).toBeLessThan(1.5);
    const saved = mean(t.map((o) => o.savedPct));
    expect(saved).toBeGreaterThan(55);
    expect(saved).toBeLessThan(68);
    // it's the corner office asking
    expect(Math.max(...t.map((o) => o.req4))).toBe(1);
    expect(Math.max(...t.map((o) => o.req1 + o.req2 + o.req3))).toBe(0);
    for (const o of t) for (let k = 0; k < 4; k++) expect(Math.abs(zo(o, "zone", k) - 74)).toBeLessThan(0.4);
  });

  it("meeting: the conference room takes over and the setpoint settles about 0.1 in. higher", () => {
    const before = mean(tail(runPreset("reset", 300).outs, 200).map((o) => o.sp));
    const { outs } = runPreset("meeting", 400);
    const t = tail(outs, 200);
    const after = mean(t.map((o) => o.sp));
    expect(after - before).toBeGreaterThan(0.06);
    expect(after - before).toBeLessThan(0.16);
    expect(Math.max(...t.map((o) => o.req3))).toBeGreaterThanOrEqual(1);
    expect(t[t.length - 1].zone3).toBeLessThan(75);
  });

  it("rogue: pinned at 1.5 in., no savings, the offices hot, flagged", () => {
    const { out } = runPreset("rogue", 200);
    expect(out.sp).toBeCloseTo(1.5, 6);
    expect(out.savedPct).toBeLessThan(2);
    expect(out.req2).toBe(3);
    expect(out.zone2).toBeGreaterThan(80);
    expect(out.rogue2).toBe(1);
    // ignore it and the reset walks back down
    const fixed = { ...preset("rogue").inputs, zones: preset("rogue").inputs.zones.map((z, k) => (k === 1 ? { ...z, importance: 0 } : z)) };
    const { final } = run(fixed, 300, (() => runPreset("rogue", 200).final)());
    expect(final.sp).toBeLessThan(0.6);
  });

  it("ignoring too many: the corner office runs short of air and drifts to about 79 °F", () => {
    const { outs } = runPreset("ignores", 500);
    const t = tail(outs, 150);
    expect(Math.abs(mean(t.map((o) => o.zone4)) - 78.7)).toBeLessThan(0.8);
    expect(mean(t.map((o) => o.q4 / o.flowSp4))).toBeLessThan(0.65);
    expect(mean(t.map((o) => o.savedPct))).toBeGreaterThan(70);
  });

  it("crushed flex: the setpoint settles near 0.7 in., fan power up about half", () => {
    const base = mean(tail(runPreset("reset", 300).outs, 200).map((o) => o.kw));
    const { outs } = runPreset("crushed", 400);
    const t = tail(outs, 200);
    expect(Math.abs(mean(t.map((o) => o.sp)) - 0.7)).toBeLessThan(0.08);
    const up = mean(t.map((o) => o.kw)) / base - 1;
    expect(up).toBeGreaterThan(0.35);
    expect(up).toBeLessThan(0.65);
  });
});
