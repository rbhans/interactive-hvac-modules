import { describe, expect, it } from "vitest";
import {
  BOX,
  DEFAULT_INPUTS,
  boxFlow,
  flowFromVp,
  init,
  outputs,
  positionFor,
  step,
  velocityPressure,
  type VavInputs,
  type VavState,
} from "./model";
import { presets } from "./presets";

const DT = 0.05;

function run(inputs: VavInputs, seconds: number, seed: Partial<VavState> = {}) {
  let s = init(inputs, seed);
  const trace: VavState[] = [];
  for (let t = 0; t < seconds; t += DT) {
    s = step(s, inputs, DT);
    trace.push(s);
  }
  return { final: s, trace, out: outputs(s, inputs) };
}
const tail = <T,>(a: T[], seconds: number) => a.slice(-Math.round(seconds / DT));
/** Half the peak-to-peak airflow over the window, as % of its mean */
const swingPct = (trace: VavState[]) => {
  const q = trace.map((s) => s.q);
  const mean = q.reduce((a, b) => a + b, 0) / q.length;
  return ((Math.max(...q) - Math.min(...q)) / 2 / mean) * 100;
};
const preset = (id: string) => presets.find((p) => p.id === id)!;

describe("the box", () => {
  it("needs about 0.35 in. of static to make its full airflow wide open", () => {
    expect(boxFlow(1, 0.35)).toBeCloseTo(1000, -1);
    expect(boxFlow(1, 1.0)).toBeGreaterThan(1600);
  });

  it("gives more air the further it opens and the harder it's pushed", () => {
    let prev = 0;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const q = boxFlow(x, 1);
      expect(q).toBeGreaterThanOrEqual(prev);
      prev = q;
    }
    expect(boxFlow(0.4, 1.5)).toBeGreaterThan(boxFlow(0.4, 1.0));
  });

  it("finds the position for an airflow, or wide open when it can't get there", () => {
    for (const [q, p] of [[390, 1], [150, 2.5], [800, 0.6]] as const) {
      expect(boxFlow(positionFor(q, p), p)).toBeCloseTo(q, 0);
    }
    expect(positionFor(900, 0.2)).toBe(1);
  });
});

describe("the flow signal", () => {
  it("is about 0.48 in. at full flow and only about 0.01 in. at minimum", () => {
    expect(velocityPressure(1000)).toBeCloseTo(0.48, 2);
    expect(velocityPressure(150)).toBeCloseTo(0.011, 3);
    // square law: half the airflow, a quarter of the signal
    expect(velocityPressure(500) / velocityPressure(1000)).toBeCloseTo(0.25, 6);
  });

  it("turns back into airflow through the K factor", () => {
    for (const q of [150, 400, 1000]) expect(flowFromVp(velocityPressure(q))).toBeCloseTo(q, 6);
  });

  it("a drift of 0.005 in. is nothing at full flow and a big error at minimum", () => {
    const err = (q: number) => flowFromVp(velocityPressure(q) + 0.005) / q - 1;
    expect(err(1000)).toBeLessThan(0.01);
    expect(err(150)).toBeGreaterThan(0.18);
  });
});

describe("control", () => {
  it("holds the room and its airflow on a steady day", () => {
    const { trace, out } = run(DEFAULT_INPUTS, 120);
    for (const s of tail(trace, 30)) {
      expect(Math.abs(s.zone - 74)).toBeLessThan(0.2);
      expect(Math.abs(s.q - 390)).toBeLessThan(8);
    }
    expect(out.bladePct).toBeGreaterThan(35);
    expect(out.bladePct).toBeLessThan(45);
  });

  it("warmer room, more air: the zone loop raises the airflow setpoint", () => {
    const hot = run({ ...DEFAULT_INPUTS, load: 14000 }, 200).out;
    expect(hot.flowSp).toBeGreaterThan(600);
    expect(Math.abs(hot.q - hot.flowSp)).toBeLessThan(hot.flowSp * 0.03);
  });

  it("manual override writes the damper at priority 8 and the flow loop has no say", () => {
    const { final, out } = run({ ...DEFAULT_INPUTS, override: { mode: "manual", value: 100 } }, 30);
    expect(final.activePriority).toBe(8);
    expect(out.bladePct).toBeGreaterThan(99);
    expect(out.q).toBeGreaterThan(1500);
  });

  it("a stuck blade stays put while the actuator keeps going", () => {
    const { final } = run({ ...DEFAULT_INPUTS, load: 16000, faults: { ...DEFAULT_INPUTS.faults, stuck: true, stuckAt: 30 } }, 60);
    expect(final.blade).toBe(30);
    expect(final.act).toBeGreaterThan(60);
  });

  it("a fouled flow cross reading high makes the box deliver less than it thinks", () => {
    const { out } = run({ ...DEFAULT_INPUTS, faults: { ...DEFAULT_INPUTS.faults, kError: 0.2 } }, 200);
    expect(out.qBas / out.q).toBeCloseTo(1.2, 1);
  });
});

describe("presets", () => {
  it("all run finite and in range", () => {
    for (const p of presets) {
      const { trace } = run(p.inputs, 60, p.seed);
      for (const s of trace) {
        expect(Number.isFinite(s.q) && Number.isFinite(s.zone)).toBe(true);
        expect(s.blade).toBeGreaterThanOrEqual(0);
        expect(s.blade).toBeLessThanOrEqual(100);
      }
    }
  });

  it("cues quote what the model does", () => {
    const steady = run(preset("steady").inputs, 120, preset("steady").seed).out;
    expect(Math.abs(steady.q - 390)).toBeLessThan(10);
    expect(steady.dpDamper).toBeCloseTo(0.96, 1);

    // swings: the pressure-independent box holds within a few %, the old one swings ~±27 %
    const pi = tail(run(preset("swings").inputs, 200, preset("swings").seed).trace, 80);
    const pd = tail(run(preset("dependent").inputs, 200, preset("dependent").seed).trace, 80);
    expect(swingPct(pi)).toBeLessThan(6);
    expect(swingPct(pd)).toBeGreaterThan(20);
    expect(swingPct(pd)).toBeLessThan(35);

    const starved = run(preset("starved").inputs, 150, preset("starved").seed).out;
    expect(starved.bladePct).toBeGreaterThan(99);
    expect(starved.starved).toBe(1);
    expect(starved.zone).toBeGreaterThan(76);
    expect(starved.qBas).toBeLessThan(starved.flowSp * 0.8);

    const drift = run(preset("drift").inputs, 150, preset("drift").seed).out;
    expect(Math.abs(drift.qBas - 150)).toBeLessThan(6);
    expect(Math.abs(drift.q - 100)).toBeLessThan(10);

    const hi = run(preset("high-static").inputs, 150, preset("high-static").seed).out;
    expect(hi.bladePct).toBeLessThan(20);
    expect(hi.dpDamper).toBeGreaterThan(2.4);
    expect(Math.abs(hi.q - hi.flowSp)).toBeLessThan(hi.flowSp * 0.05);
  });
});

it("design numbers stay what the copy says", () => {
  expect(BOX.design).toBe(1000);
});
