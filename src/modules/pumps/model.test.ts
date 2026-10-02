import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUTS,
  DESIGN,
  bothWays,
  init,
  operatingFlow,
  outputs,
  pumpHead,
  pumpKw,
  speedFor,
  step,
  systemK,
  valveFor,
  type PumpInputs,
  type PumpOutputs,
  type PumpState,
} from "./model";
import { presets } from "./presets";

const DT = 0.05;

function run(inputs: PumpInputs, seconds: number, seed: Partial<PumpState> = {}) {
  let s = init(inputs, seed);
  const outs: PumpOutputs[] = [];
  for (let k = 0; k * DT < seconds; k++) {
    s = step(s, inputs, DT);
    if (k % 10 === 0) outs.push(outputs(s, inputs));
  }
  return { final: s, outs, out: outputs(s, inputs) };
}
const preset = (id: string) => presets.find((p) => p.id === id)!;
const runPreset = (id: string, seconds = 40) => run(preset(id).inputs, seconds, preset(id).seed);
const i = DEFAULT_INPUTS;

describe("pump and system", () => {
  it("the right-size pump meets the pipes at design: 400 gpm at 70 ft", () => {
    expect(operatingFlow(1, 1, i)).toBeCloseTo(DESIGN.flow, 0);
    expect(pumpHead(DESIGN.flow, 1, i)).toBeCloseTo(DESIGN.head, 0);
    expect(systemK(1, i) * DESIGN.flow ** 2).toBeCloseTo(DESIGN.head, 6);
  });

  it("affinity: in a closed loop, flow goes with speed, head with speed², power about speed³", () => {
    for (const n of [0.5, 0.75, 0.9]) {
      const q = operatingFlow(n, 1, i);
      expect(q / DESIGN.flow).toBeCloseTo(n, 3);
      expect(pumpHead(q, n, i) / DESIGN.head).toBeCloseTo(n * n, 3);
    }
    const p1 = pumpKw(DESIGN.flow, DESIGN.head, 1, i);
    const q = operatingFlow(0.75, 1, i);
    const ratio = pumpKw(q, pumpHead(q, 0.75, i), 0.75, i) / p1;
    // the cube, a little more for the slower motor and drive
    expect(ratio).toBeGreaterThan(0.75 ** 3);
    expect(ratio).toBeLessThan(0.75 ** 3 * 1.1);
  });

  it("closing the valve trades flow for head at the same speed", () => {
    const q = operatingFlow(1, 0.6, i);
    expect(q).toBeLessThan(DESIGN.flow);
    expect(pumpHead(q, 1, i)).toBeGreaterThan(DESIGN.head);
  });

  it("valveFor and speedFor hit the flow", () => {
    expect(operatingFlow(1, valveFor(300, i), i)).toBeCloseTo(300, 0);
    expect(operatingFlow(speedFor(300, i), 1, i)).toBeCloseTo(300, 0);
  });

  it("300 gpm: choked 6.8 kW with the valve near 60 %, slowed 3.1 kW at 45 Hz", () => {
    const w = bothWays(300, i);
    expect(w.throttled).toBeCloseTo(6.75, 1);
    expect(w.slowed).toBeCloseTo(3.13, 1);
    expect(w.valve).toBeGreaterThan(0.55);
    expect(w.valve).toBeLessThan(0.65);
    expect(w.speed * 60).toBeCloseTo(45, 0);
  });
});

describe("control", () => {
  it("the flow loop gets the flow either way", () => {
    for (const method of ["vfd", "valve"] as const) {
      const { outs } = run({ ...i, method, flowSp: 250 }, 60, { speed: 100, valve: 100, loopI: 100, loopOut: 100 });
      const last = outs.slice(-20);
      for (const o of last) expect(Math.abs(o.q - 250)).toBeLessThan(5);
      if (method === "vfd") expect(last[last.length - 1].valvePct).toBeGreaterThan(99);
      else expect(last[last.length - 1].speedPct).toBeGreaterThan(99);
    }
  });

  it("Hand writes the speed at priority 8 and the loop has no say", () => {
    const { final, out } = run({ ...i, override: { mode: "manual", value: 70 } }, 20);
    expect(final.activePriority).toBe(8);
    expect(out.hz).toBeCloseTo(42, 0);
  });
});

describe("presets", () => {
  it("all run finite and in range", () => {
    for (const p of presets) {
      const { outs } = run(p.inputs, 30, p.seed);
      for (const o of outs) {
        expect(Number.isFinite(o.q) && Number.isFinite(o.kw) && Number.isFinite(o.head)).toBe(true);
        expect(o.valvePct).toBeGreaterThanOrEqual(0);
        expect(o.valvePct).toBeLessThanOrEqual(100);
        expect(o.speedPct).toBeLessThanOrEqual(100);
      }
    }
  });

  it("slowed: 300 gpm at 45 Hz, 3.1 kW", () => {
    const { out } = runPreset("slowed");
    expect(out.q).toBeCloseTo(300, -1);
    expect(Math.round(out.hz)).toBe(45);
    expect(out.kw).toBeCloseTo(3.1, 1);
  });

  it("throttled: 60 Hz, valve about 60 %, burns 42 ft, 6.8 kW", () => {
    const { out } = runPreset("throttled");
    expect(out.hz).toBeCloseTo(60, 0);
    expect(Math.abs(out.valvePct - 60)).toBeLessThan(4);
    expect(out.hValve).toBeCloseTo(42, -0.5);
    expect(out.kw).toBeCloseTo(6.8, 1);
    expect(out.kw / out.kwOther).toBeGreaterThan(2);
  });

  it("oversized: 460 gpm wide open, balanced to 400 at 71 %, burns 35 ft, 10.8 kW vs 7.3 at 52 Hz", () => {
    const over = preset("oversized").inputs;
    expect(operatingFlow(1, 1, over)).toBeCloseTo(462, -1);
    const { out } = runPreset("oversized");
    expect(out.q).toBeCloseTo(400, -1);
    expect(Math.abs(out.valvePct - 71)).toBeLessThan(3);
    expect(out.hValve).toBeCloseTo(35, -0.5);
    expect(out.kw).toBeCloseTo(10.8, 1);
    expect(out.kwOther).toBeCloseTo(7.3, 1);
    expect(speedFor(400, over) * 60).toBeCloseTo(52, 0);
  });

  it("hand: 400 gpm and 7.4 kW where 300 and 3.1 were wanted", () => {
    const { out } = runPreset("hand");
    expect(out.q).toBeCloseTo(400, -1);
    expect(out.kw).toBeCloseTo(7.4, 1);
    expect(out.kwOther).toBeLessThan(7.4);
    expect(out.short).toBe(0);
  });

  it("backwards: 60 Hz, 255 gpm against 28 ft, short of flow", () => {
    const { out } = runPreset("backwards");
    expect(out.hz).toBeCloseTo(60, 0);
    expect(out.q).toBeCloseTo(255, -1);
    expect(out.head).toBeCloseTo(28, 0);
    expect(out.short).toBe(1);
  });

  it("strainer: 60 Hz, 352 gpm, suction gauge 12 psi instead of 21, 23 ft in the strainer", () => {
    const { out } = runPreset("strainer");
    expect(out.hz).toBeCloseTo(60, 0);
    expect(out.q).toBeCloseTo(352, -1);
    expect(out.suction).toBeCloseTo(12, 0);
    expect(out.hStrainer).toBeCloseTo(23, 0);
    const clean = run({ ...preset("strainer").inputs, faults: { reversed: false, clog: 0 } }, 30).out;
    expect(clean.suction).toBeCloseTo(21, 0);
  });
});
