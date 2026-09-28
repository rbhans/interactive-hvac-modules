import { describe, expect, it } from "vitest";
import {
  COILS,
  DEFAULT_INPUTS,
  coilCurve,
  coilSteady,
  dewPoint,
  init,
  outputs,
  PHYSICS,
  step,
  VALVE_SIZES,
  valveFlow,
  valveInstalled,
  type CoilInputs,
  type CoilState,
} from "./model";
import { presets } from "./presets";

const DT = 0.05;

function run(inputs: CoilInputs, seconds: number, seed: Partial<CoilState> = {}) {
  let s = init(inputs, seed);
  const trace: CoilState[] = [];
  for (let t = 0; t < seconds; t += DT) {
    s = step(s, inputs, DT);
    trace.push(s);
  }
  return { final: s, trace, out: outputs(s, inputs) };
}
const tail = <T,>(a: T[], seconds: number) => a.slice(-Math.round(seconds / DT));

describe("coil heat transfer", () => {
  it("hits its design points", () => {
    const c = coilSteady(COILS.chw, 78, 44, 1, 1);
    expect(c.lat).toBeCloseTo(55, 0);
    expect(c.dtWater).toBeCloseTo(12, 0);
    const h = coilSteady(COILS.hw, 50, 180, 1, 1);
    expect(h.lat).toBeCloseTo(90, 0);
    expect(h.dtWater).toBeCloseTo(20, 0);
  });

  it("balances energy: what the air gains the water loses", () => {
    for (const [spec, eat, ewt] of [[COILS.chw, 78, 44], [COILS.hw, 45, 180]] as const) {
      for (const g of [0.1, 0.4, 1, 1.3]) {
        const r = coilSteady(spec, eat, ewt, g, 0.8);
        const air = 1.08 * 2500 * 0.8 * (r.lat - eat);
        const water = 500 * spec.gpm * g * (ewt - r.lwt);
        expect(air).toBeCloseTo(water, 3);
      }
    }
  });

  it("never pushes air past the water temperature", () => {
    for (const g of [0.05, 0.5, 1, 1.35]) {
      const c = coilSteady(COILS.chw, 80, 44, g, 1);
      expect(c.lat).toBeGreaterThanOrEqual(44);
      expect(c.lat).toBeLessThanOrEqual(80);
      const h = coilSteady(COILS.hw, 30, 180, g, 1);
      expect(h.lat).toBeLessThanOrEqual(180);
      expect(h.lat).toBeGreaterThanOrEqual(30);
    }
  });

  it("half the water does most of the work, and the water's temperature change grows as flow drops", () => {
    expect(coilCurve(COILS.chw, 78, 44, 0.5, 1)).toBeGreaterThan(0.75);
    expect(coilCurve(COILS.hw, 50, 180, 0.5, 1)).toBeGreaterThan(0.75);
    let prevQ = 0;
    let prevDt = Infinity;
    for (let g = 0.1; g <= 1.3; g += 0.1) {
      const r = coilSteady(COILS.chw, 78, 44, g, 1);
      expect(-r.q).toBeGreaterThan(prevQ);
      expect(r.dtWater).toBeLessThan(prevDt);
      prevQ = -r.q;
      prevDt = r.dtWater;
    }
  });

  it("condenses only when the fin surface is below the dew point", () => {
    expect(dewPoint(75, 50)).toBeCloseTo(55, 0);
    const wet = run({ ...DEFAULT_INPUTS, eat: 78, rh: 65 }, 40).out;
    expect(wet.condensate).toBeGreaterThan(0);
    const dry = run({ ...DEFAULT_INPUTS, eat: 70, rh: 25 }, 40).out;
    expect(dry.condensate).toBe(0);
  });
});

describe("valves", () => {
  it("equal-percentage plus coil is close to linear; linear or oversized is quick-opening", () => {
    const heatAt = (x: number, char: "equal" | "linear", size: "right" | "oversized") =>
      coilCurve(COILS.chw, 78, 44, valveFlow(x, char, size), 1, valveFlow(1, char, size));
    // right-sized equal-% valve: half open ≈ half the cooling
    expect(Math.abs(heatAt(0.5, "equal", "right") - 0.5)).toBeLessThan(0.1);
    // linear and oversized: most of the cooling in the first third of the stroke
    expect(heatAt(0.3, "linear", "oversized")).toBeGreaterThan(0.85);
  });

  it("leaks when told to, and passes nothing otherwise when shut", () => {
    expect(valveFlow(0, "equal", "right")).toBe(0);
    expect(valveFlow(0, "equal", "right", 0.1)).toBeGreaterThan(0.09);
  });

  it("installed flow is monotonic in position", () => {
    for (const char of ["equal", "linear"] as const) {
      let prev = -1;
      for (let x = 0; x <= 1.0001; x += 0.02) {
        const v = valveInstalled(x, char, 0.3);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });
});

describe("discharge air loop", () => {
  it("holds the cooling setpoint", () => {
    const { trace } = run({ ...DEFAULT_INPUTS, eat: 70 }, 120, { act: { chw: 30, hw: 0 } });
    for (const s of tail(trace, 20)) expect(Math.abs(s.datDisplayed - 55)).toBeLessThan(0.6);
  });

  it("holds the heating setpoint and keeps the chilled-water valve shut", () => {
    const { trace, final } = run({ ...DEFAULT_INPUTS, mode: "heating", eat: 45 }, 120, { act: { chw: 0, hw: 20 } });
    for (const s of tail(trace, 20)) expect(Math.abs(s.datDisplayed - 72)).toBeLessThan(0.6);
    expect(final.stem.chw).toBe(0);
  });

  it("switching modes shuts the old valve and starts the new one from shut", () => {
    const cooling = run({ ...DEFAULT_INPUTS, eat: 70 }, 60, { act: { chw: 30, hw: 0 } }).final;
    const s = step(cooling, { ...DEFAULT_INPUTS, mode: "heating", eat: 45 }, DT);
    expect(s.integral).toBeLessThan(5);
    const later = run({ ...DEFAULT_INPUTS, mode: "heating", eat: 45 }, 30, cooling).final;
    expect(later.stem.chw).toBe(0);
  });

  it("an oversized linear heating valve hunts at low load; a right-sized one doesn't", () => {
    const swing = (inputs: CoilInputs) => {
      const w = tail(run(inputs, 200, { act: { chw: 0, hw: 10 } }).trace, 50).map((s) => s.datDisplayed);
      return Math.max(...w) - Math.min(...w);
    };
    expect(swing({ ...DEFAULT_INPUTS, mode: "heating", eat: 55, valveSize: "oversized", valveChar: "linear" })).toBeGreaterThan(2);
    expect(swing({ ...DEFAULT_INPUTS, mode: "heating", eat: 55 })).toBeLessThan(0.8);
  });

  it("manual override writes at priority 8 and the loop has no effect", () => {
    const { final, out } = run({ ...DEFAULT_INPUTS, eat: 70, override: { mode: "manual", value: 100 } }, 60);
    expect(final.activePriority).toBe(8);
    expect(out.datTrue).toBeLessThan(DEFAULT_INPUTS.coolSp - 1.5);
  });
});

describe("faults", () => {
  it("a leaking heating valve warms the air while cooling, and the cooling coil pays for it", () => {
    const clean = run({ ...DEFAULT_INPUTS, eat: 70 }, 120, { act: { chw: 60, hw: 0 } }).out;
    const leaky = run({ ...DEFAULT_INPUTS, eat: 70, faults: { ...DEFAULT_INPUTS.faults, hwLeak: 0.08 } }, 120, { act: { chw: 60, hw: 0 } }).out;
    expect(leaky.hwRise).toBeGreaterThan(5);
    expect(leaky.stemPct).toBeGreaterThan(clean.stemPct + 15);
    expect(leaky.fightBtuh).toBeGreaterThan(10000);
  });

  it("a stuck valve holds its stem while the actuator follows the command", () => {
    const { final } = run({ ...DEFAULT_INPUTS, eat: 76, faults: { ...DEFAULT_INPUTS.faults, stuck: true, stuckAt: 20 } }, 60);
    expect(final.stem.chw).toBe(20);
    expect(final.act.chw).toBeGreaterThan(90);
  });

  it("a stuck stem stays with its valve when the mode changes", () => {
    const inputs: CoilInputs = { ...DEFAULT_INPUTS, eat: 76, faults: { ...DEFAULT_INPUTS.faults, stuck: true, stuckAt: 77 } };
    let s = run(inputs, 30).final;
    const heating: CoilInputs = { ...inputs, mode: "heating", eat: 55 };
    for (let t = 0; t < 60; t += DT) s = step(s, heating, DT);
    // the chilled-water stem is still stuck open; the hot-water valve works normally
    expect(s.stem.chw).toBe(77);
    expect(s.act.chw).toBe(0);
    expect(Math.abs(s.stem.hw - s.act.hw)).toBeLessThanOrEqual(PHYSICS.backlash);
    const o = outputs(s, heating);
    expect(o.stuckChw).toBe(1);
    expect(o.stuckHw).toBe(0);
  });

  it("a valve driven wide open reaches full stroke despite backlash", () => {
    const inputs: CoilInputs = { ...DEFAULT_INPUTS, override: { mode: "manual", value: 100 } };
    const { final } = run(inputs, 30);
    expect(final.stem.chw).toBe(100);
    expect(outputs(final, inputs).chwFlow).toBeCloseTo(VALVE_SIZES.right.maxFlow, 6);
  });

  it("a discharge sensor error biases the reading only", () => {
    const { final } = run({ ...DEFAULT_INPUTS, eat: 70, faults: { ...DEFAULT_INPUTS.faults, datOffset: 3 } }, 150, { act: { chw: 70, hw: 0 } });
    expect(final.datDisplayed - final.datSensor).toBeCloseTo(3, 9);
    expect(final.lat.chw).toBeCloseTo(52, 0);
  });
});

describe("presets", () => {
  it("all run finite and bounded", () => {
    for (const p of presets) {
      const { trace } = run(p.inputs, 60, p.seed);
      for (const s of trace) {
        expect(Number.isFinite(s.datDisplayed)).toBe(true);
        expect(s.stem.chw).toBeGreaterThanOrEqual(0);
        expect(s.stem.hw).toBeLessThanOrEqual(100);
      }
    }
  });

  it("cues quote what the model does", () => {
    const get = (id: string) => presets.find((p) => p.id === id)!;
    const warm = run(get("warm-afternoon").inputs, 150, get("warm-afternoon").seed).out;
    expect(warm.flowOfMax).toBeGreaterThan(50);
    expect(warm.flowOfMax).toBeLessThan(65);
    expect(warm.capOfMax).toBeGreaterThan(80);

    const cold = run(get("cold-morning").inputs, 150, get("cold-morning").seed).out;
    expect(cold.flowOfMax).toBeLessThan(33);
    expect(cold.capOfMax).toBeGreaterThan(60);

    const wide = run(get("wide-open").inputs, 150, get("wide-open").seed).out;
    expect(wide.flowOfMax / warm.flowOfMax).toBeGreaterThan(1.5);
    expect(wide.capOfMax - warm.capOfMax).toBeLessThan(20);
    expect(wide.activeDt).toBeLessThan(warm.activeDt - 3);

    const leak = run(get("leaking").inputs, 150, get("leaking").seed).out;
    expect(leak.stemPct).toBeGreaterThan(95);
    expect(leak.hwRise).toBeGreaterThan(5);

    const warmChw = run(get("warm-chw").inputs, 150, get("warm-chw").seed).out;
    expect(warmChw.datTrue).toBeGreaterThan(57);
  });
});
