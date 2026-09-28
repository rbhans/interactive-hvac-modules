import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUTS,
  FREEZE,
  init,
  inherentCurve,
  installedCurve,
  oaFraction,
  outputs,
  positionForFraction,
  step,
  type EconInputs,
  type EconState,
} from "./model";
import { presets } from "./presets";

const DT = 0.05;

function run(inputs: EconInputs, seconds: number, seed: Partial<EconState> = {}) {
  let s = init(inputs, seed);
  const trace: EconState[] = [];
  for (let t = 0; t < seconds; t += DT) {
    s = step(s, inputs, DT);
    trace.push(s);
  }
  return { final: s, trace };
}

const window = (trace: EconState[], seconds: number) => trace.slice(-Math.round(seconds / DT));

/** Small deterministic PRNG so property tests are reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("installed characteristic", () => {
  it("is monotonic and bounded for both blade types across authorities", () => {
    for (const blade of ["opposed", "parallel"] as const) {
      for (const n of [0.02, 0.05, 0.1, 0.3, 1]) {
        let prev = -Infinity;
        for (let x = 0; x <= 1.0001; x += 0.01) {
          const v = installedCurve(x, n, blade);
          expect(v).toBeGreaterThanOrEqual(prev);
          expect(v).toBeGreaterThan(0);
          expect(v).toBeLessThanOrEqual(1 + 1e-9);
          prev = v;
        }
        expect(installedCurve(1, n, blade)).toBeCloseTo(1, 6);
      }
    }
  });

  it("matches the ASHRAE rule of thumb for a near-linear installed curve", () => {
    // opposed blades at a system/damper ratio of ~10, parallel at ~2.5
    expect(installedCurve(0.5, 1 / 11, "opposed")).toBeCloseTo(0.5, 1);
    expect(installedCurve(0.5, 1 / 3.5, "parallel")).toBeCloseTo(0.5, 1);
  });

  it("approaches the inherent curve at full authority", () => {
    for (const x of [0.2, 0.5, 0.8]) {
      expect(installedCurve(x, 1, "opposed")).toBeCloseTo(inherentCurve(x, "opposed"), 6);
    }
  });

  it("gets more quick-opening as authority drops", () => {
    expect(installedCurve(0.3, 0.03, "opposed")).toBeGreaterThan(installedCurve(0.3, 0.3, "opposed"));
    expect(installedCurve(0.3, 0.05, "parallel")).toBeGreaterThan(installedCurve(0.3, 0.05, "opposed"));
  });

  it("inverts with positionForFraction", () => {
    for (const f of [0.1, 0.3, 0.7, 0.95]) {
      const x = positionForFraction(f, 0.1, "opposed", 1.2);
      expect(oaFraction(x, 0.1, "opposed", 1.2)).toBeCloseTo(f, 4);
    }
  });
});

describe("mixing box OA fraction (linked OA and RA dampers)", () => {
  it("crosses 50/50 at mid-stroke only when the paths are balanced", () => {
    for (const blade of ["opposed", "parallel"] as const) {
      expect(oaFraction(0.5, 0.1, blade, 1)).toBeCloseTo(0.5, 9);
      expect(oaFraction(0.5, 0.1, blade, 1.4)).toBeLessThan(0.45);
      expect(oaFraction(0.5, 0.1, blade, 0.7)).toBeGreaterThan(0.55);
    }
  });

  it("puts the gap where minimum OA lives: default min position is not min OA", () => {
    const { minOaPos, authority, bladeType, returnBalance } = DEFAULT_INPUTS;
    const pct = oaFraction(minOaPos / 100, authority, bladeType, returnBalance) * 100;
    expect(minOaPos - pct).toBeGreaterThan(8);
  });

  it("gives more OA at every position when the return side is weaker", () => {
    for (let x = 0.05; x < 1; x += 0.1) {
      expect(oaFraction(x, 0.1, "opposed", 0.7)).toBeGreaterThan(oaFraction(x, 0.1, "opposed", 1));
    }
  });

  it("runs from leakage to (nearly) all outdoor air across the stroke", () => {
    expect(oaFraction(0, 0.1, "opposed")).toBeLessThan(0.02);
    expect(oaFraction(1, 0.1, "opposed")).toBeGreaterThan(0.98);
  });
});

describe("mixing", () => {
  it("keeps true MAT between OAT and RAT for any inputs and damper motion", () => {
    const r = rng(42);
    for (let k = 0; k < 60; k++) {
      const inputs: EconInputs = {
        ...DEFAULT_INPUTS,
        oat: -10 + r() * 120,
        rat: 65 + r() * 15,
        matSp: 45 + r() * 20,
        minOaPos: r() * 40,
        highLimit: 55 + r() * 25,
        kp: 0.5 + r() * 25,
        bladeType: r() > 0.5 ? "opposed" : "parallel",
        authority: 0.02 + r() * 0.9,
      };
      const lo = Math.min(inputs.oat, inputs.rat) - 1e-9;
      const hi = Math.max(inputs.oat, inputs.rat) + 1e-9;
      // start from a different weather so the lags are genuinely in transit
      let s = init({ ...inputs, oat: inputs.rat });
      for (let t = 0; t < 60; t += DT) {
        s = step(s, inputs, DT);
        if (t > 20) {
          expect(s.matTrue).toBeGreaterThanOrEqual(lo);
          expect(s.matTrue).toBeLessThanOrEqual(hi);
        }
        expect(s.oaFrac).toBeGreaterThan(0);
        expect(s.oaFrac).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("MAT loop", () => {
  it("holds setpoint on a mild day with default tuning", () => {
    const { final, trace } = run(DEFAULT_INPUTS, 90, { actuatorPos: DEFAULT_INPUTS.minOaPos });
    expect(final.econEnabled).toBe(true);
    for (const s of window(trace, 20)) expect(Math.abs(s.matDisplayed - DEFAULT_INPUTS.matSp)).toBeLessThan(0.4);
    // …and the position it settles at is not the OA percentage it delivers
    expect(Math.abs(final.oaFrac * 100 - final.bladePos)).toBeGreaterThan(5);
  });

  it("never commands below minimum OA while in auto", () => {
    const inputs = { ...DEFAULT_INPUTS, oat: -5, minOaPos: 22 };
    const { trace } = run(inputs, 90);
    for (const s of trace) expect(s.cmd).toBeGreaterThanOrEqual(22 - 1e-9);
  });

  it("hunts when the gain is too high", () => {
    const inputs = { ...DEFAULT_INPUTS, kp: 16 };
    const { trace } = run(inputs, 150, { actuatorPos: inputs.minOaPos });
    const w = window(trace, 40);
    const swing = Math.max(...w.map((s) => s.bladePos)) - Math.min(...w.map((s) => s.bladePos));
    const matSwing = Math.max(...w.map((s) => s.matTrue)) - Math.min(...w.map((s) => s.matTrue));
    expect(swing).toBeGreaterThan(20);
    expect(matSwing).toBeGreaterThan(2);
  });
});

describe("changeover", () => {
  it("drops to minimum OA above the high limit and stays there", () => {
    const inputs = { ...DEFAULT_INPUTS, oat: 88, rat: 75, highLimit: 70 };
    const { final } = run(inputs, 30, { actuatorPos: 80, loopOut: 80 });
    expect(final.econEnabled).toBe(false);
    expect(final.loopOut).toBe(inputs.minOaPos);
    expect(final.actuatorPos).toBeCloseTo(inputs.minOaPos, 6);
  });

  it("re-enables only once OAT falls below the deadband", () => {
    const hot = run({ ...DEFAULT_INPUTS, oat: 72 }, 2).final;
    expect(hot.econEnabled).toBe(false);
    expect(step(hot, { ...DEFAULT_INPUTS, oat: 69 }, DT).econEnabled).toBe(false);
    expect(step(hot, { ...DEFAULT_INPUTS, oat: 67.5 }, DT).econEnabled).toBe(true);
  });
});

describe("override", () => {
  it("writes at priority 8 and the loop has no effect", () => {
    // 45 °F: cold enough to waste heat, warm enough not to trip freeze protection
    const inputs: EconInputs = { ...DEFAULT_INPUTS, oat: 45, override: { mode: "manual", value: 100 } };
    const { final } = run(inputs, 40);
    expect(final.activePriority).toBe(8);
    expect(final.cmd).toBe(100);
    expect(final.actuatorPos).toBeCloseTo(100, 6);
    // the loop is asking for minimum while the damper sits wide open
    expect(final.loopOut).toBe(inputs.minOaPos);
    expect(final.matTrue).toBeLessThan(inputs.matSp - 8);
  });

  it("returns control to the loop at priority 16 when released", () => {
    const manual = run({ ...DEFAULT_INPUTS, override: { mode: "manual", value: 100 } }, 10).final;
    const released = step(manual, DEFAULT_INPUTS, DT);
    expect(released.activePriority).toBe(16);
    expect(released.cmd).toBe(released.loopOut);
  });
});

describe("freeze protection", () => {
  it("overrides an operator at priority 5 and recovers", () => {
    const inputs: EconInputs = { ...DEFAULT_INPUTS, oat: 20, override: { mode: "manual", value: 100 } };
    let s = init(inputs, { actuatorPos: 100 });
    let tripped = false;
    for (let t = 0; t < 15; t += DT) {
      s = step(s, inputs, DT);
      if (s.activePriority === 5) tripped = true;
    }
    expect(tripped).toBe(true);
    expect(s.cmd).toBeLessThanOrEqual(DEFAULT_INPUTS.minOaPos);
    expect(s.matTrue).toBeGreaterThan(FREEZE.stage1);
  });

  it("holds the safety until MAT has stayed warm for the release time", () => {
    const inputs: EconInputs = { ...DEFAULT_INPUTS, oat: 20, override: { mode: "manual", value: 100 } };
    let s = init(inputs, { actuatorPos: 100 });
    let firstWarm = -1;
    let released = -1;
    for (let t = 0; t < 80 && released < 0; t += DT) {
      s = step(s, inputs, DT);
      if (firstWarm < 0 && s.freezeStage > 0 && s.matDisplayed > FREEZE.release) firstWarm = t;
      if (firstWarm >= 0 && s.activePriority !== 5) released = t;
    }
    expect(released - firstWarm).toBeGreaterThanOrEqual(FREEZE.releaseHold - 0.1);
  });

  it("stays out of the way in normal operation", () => {
    const { trace } = run(DEFAULT_INPUTS, 60, { actuatorPos: DEFAULT_INPUTS.minOaPos });
    for (const s of trace) expect(s.activePriority).toBe(16);
  });

  it("hands back to a loop that hasn't wound up, so a cold snap trips once and settles", () => {
    // settle on a mild day with the damper well open, then the outside drops to −10 °F
    let s = run(DEFAULT_INPUTS, 120).final;
    const cold: EconInputs = { ...DEFAULT_INPUTS, oat: -10 };
    let trips = 0;
    let maxCmdAfterRelease = 0;
    let released = false;
    for (let t = 0; t < 600; t += DT) {
      const prev = s.freezeStage;
      s = step(s, cold, DT);
      if (!prev && s.freezeStage) trips++;
      if (prev && !s.freezeStage) released = true;
      if (released) maxCmdAfterRelease = Math.max(maxCmdAfterRelease, s.cmd);
    }
    expect(trips).toBe(1);
    // the program resumes from minimum rather than throwing the damper open
    expect(maxCmdAfterRelease).toBeLessThan(60);
    expect(s.freezeStage).toBe(0);
    expect(s.matDisplayed).toBeCloseTo(cold.matSp, 0);
  });
});

describe("outputs", () => {
  it("report the priority the current inputs call for, before the next step", () => {
    const s = run(DEFAULT_INPUTS, 5).final;
    expect(outputs(s, DEFAULT_INPUTS).activePriority).toBe(16);
    expect(outputs(s, { ...DEFAULT_INPUTS, override: { mode: "manual", value: 80 } }).activePriority).toBe(8);
  });
});

describe("faults", () => {
  it("stuck damper: the actuator follows command, the blades don't, and the BAS looks normal", () => {
    const inputs: EconInputs = {
      ...DEFAULT_INPUTS,
      oat: 45,
      faults: { stuckDamper: true, stuckAt: 8, matOffset: 0 },
    };
    const { final } = run(inputs, 60);
    expect(final.cmd).toBeCloseTo(100, 6); // loop winds up
    expect(final.actuatorPos).toBeCloseTo(final.cmd, 6); // feedback matches command
    expect(final.bladePos).toBe(8); // reality doesn't
    expect(final.matDisplayed - inputs.matSp).toBeGreaterThan(10);
  });

  it("sensor offset biases the displayed value only — and the loop drives true MAT off setpoint", () => {
    const inputs: EconInputs = { ...DEFAULT_INPUTS, faults: { stuckDamper: false, stuckAt: 8, matOffset: 3 } };
    const { final } = run(inputs, 120, { actuatorPos: 30 });
    expect(final.matDisplayed - final.matSensor).toBeCloseTo(3, 9);
    expect(final.matDisplayed).toBeCloseTo(inputs.matSp, 1);
    expect(final.matTrue).toBeCloseTo(inputs.matSp - 3, 1);
    // and the temperature-method OA % the BAS calculates is now wrong
    const o = outputs(final, inputs);
    expect(Math.abs(o.oaPctCalc - o.oaPct)).toBeGreaterThan(5);
  });
});

describe("presets", () => {
  it("every preset produces a finite, bounded simulation", () => {
    for (const p of presets) {
      const { trace } = run(p.inputs, 60, p.seed);
      for (const s of trace) {
        expect(Number.isFinite(s.matTrue)).toBe(true);
        expect(s.bladePos).toBeGreaterThanOrEqual(0);
        expect(s.bladePos).toBeLessThanOrEqual(100);
      }
    }
  });

  it("hot day locks out, cold day modulates just above minimum", () => {
    const hot = presets.find((p) => p.id === "hot-day")!;
    expect(run(hot.inputs, 30, hot.seed).final.econEnabled).toBe(false);
    const cold = presets.find((p) => p.id === "cold-day")!;
    const c = run(cold.inputs, 90, cold.seed).final;
    expect(c.bladePos).toBeGreaterThan(cold.inputs.minOaPos);
    expect(c.bladePos).toBeLessThan(cold.inputs.minOaPos + 8);
  });

  it("cues quote what the model actually does", () => {
    const mild = presets.find((p) => p.id === "mild-day")!;
    const m = run(mild.inputs, 90, mild.seed).final;
    expect(Math.round(m.bladePos)).toBeGreaterThanOrEqual(60);
    expect(Math.round(m.bladePos)).toBeLessThanOrEqual(64);
    expect(Math.round(m.oaFrac * 100)).toBeGreaterThanOrEqual(69);
    expect(Math.round(m.oaFrac * 100)).toBeLessThanOrEqual(73);

    const hot = presets.find((p) => p.id === "hot-day")!;
    expect(run(hot.inputs, 30, hot.seed).final.oaFrac).toBeLessThan(0.08);

    const cold = presets.find((p) => p.id === "cold-day")!;
    const minFrac = oaFraction(cold.inputs.minOaPos / 100, cold.inputs.authority, cold.inputs.bladeType, cold.inputs.returnBalance);
    expect(minFrac).toBeCloseTo(0.2, 1);

    const ovr = presets.find((p) => p.id === "override")!;
    const o = run(ovr.inputs, 30, ovr.seed).final;
    expect(ovr.inputs.matSp - o.matTrue).toBeGreaterThan(8);
    expect(o.activePriority).toBe(8);

    const stuck = presets.find((p) => p.id === "stuck")!;
    expect(run(stuck.inputs, 30, stuck.seed).final.bladePos).toBe(8);
  });
});
