import { describe, expect, it } from "vitest";
import {
  COIL,
  DEFAULT_INPUTS,
  LOOP,
  coilCapacity,
  co,
  flowNeeded,
  init,
  outputs,
  solve,
  step,
  type ValveInputs,
  type ValveOutputs,
  type ValveState,
} from "./model";
import { presets } from "./presets";

const DT = 0.05;

function run(inputs: ValveInputs, seconds: number, seed: Partial<ValveState> = {}) {
  let s = init(inputs, seed);
  const outs: ValveOutputs[] = [];
  for (let k = 0; k * DT < seconds; k++) {
    s = step(s, inputs, DT);
    if (k % 10 === 0) outs.push(outputs(s, inputs));
  }
  return { final: s, outs, out: outputs(s, inputs) };
}
const preset = (id: string) => presets.find((p) => p.id === id)!;
const runPreset = (id: string, seconds = 30) => run(preset(id).inputs, seconds, preset(id).seed);
const i = DEFAULT_INPUTS;

describe("the coils", () => {
  it("half the water does most of the work, and flowNeeded inverts it", () => {
    expect(coilCapacity(1)).toBeCloseTo(1, 6);
    expect(coilCapacity(0.5)).toBeGreaterThan(0.65);
    for (const c of [0.2, 0.5, 0.8, 1]) expect(coilCapacity(flowNeeded(c))).toBeCloseTo(c, 4);
  });

  it("water can't leave warmer than a few degrees under the air coming in", () => {
    for (const phi of [0.02, 0.05, 0.1]) {
      const lwt = COIL.supply + (coilCapacity(phi) * COIL.dT) / phi;
      expect(lwt).toBeLessThanOrEqual(COIL.airIn - 3 + 1e-6);
    }
  });
});

describe("the loop", () => {
  it("a three-way branch passes about the same water whatever its valve does; a two-way branch doesn't", () => {
    const three = (x: number) => solve(0.95, [0.5, 0.5, x], i).q[2];
    expect(three(0.1) / three(1)).toBeGreaterThan(0.95);
    const two = { ...i, kinds: ["two", "two", "two"] } as ValveInputs;
    const twoQ = (x: number) => solve(0.95, [0.5, 0.5, x], two).q[2];
    expect(twoQ(0.3) / twoQ(1)).toBeLessThan(0.3);
  });

  it("each coil's loop delivers its load", () => {
    for (const kinds of [["three", "three", "three"], ["two", "two", "two"]] as ValveInputs["kinds"][]) {
      const { out } = run({ ...i, kinds }, 30);
      for (let k = 0; k < 3; k++) expect(Math.abs(co(out, "delivered", k) - co(out, "load", k))).toBeLessThan(1.5);
    }
  });

  it("the pump holds the DP across the far coil", () => {
    const { outs } = run({ ...i, kinds: ["two", "two", "two"] }, 30);
    for (const o of outs.slice(-20)) expect(Math.abs(o.dp - i.dpSp)).toBeLessThan(0.3);
  });

  it("Hand writes the speed at priority 8", () => {
    const { final, out } = run({ ...i, override: { mode: "manual", value: 80 } }, 20);
    expect(final.activePriority).toBe(8);
    expect(out.hz).toBeCloseTo(48, 0);
  });
});

describe("presets", () => {
  it("all run finite and in range", () => {
    for (const p of presets) {
      const { outs } = run(p.inputs, 20, p.seed);
      for (const o of outs) {
        expect(Number.isFinite(o.total) && Number.isFinite(o.kw) && Number.isFinite(o.returnT)).toBe(true);
        for (let k = 0; k < 3; k++) {
          expect(co(o, "valve", k)).toBeGreaterThanOrEqual(0);
          expect(co(o, "valve", k)).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it("three-way: 324 gpm, 58 Hz, 4.5 kW, back 7 °F warmer", () => {
    const { out } = runPreset("three");
    expect(out.total).toBeCloseTo(324, -1);
    expect(Math.round(out.hz)).toBe(58);
    expect(out.kw).toBeCloseTo(4.5, 1);
    expect(Math.round(out.deltaT)).toBe(7);
  });

  it("two-way: 122 gpm, 33 Hz, 0.9 kW, back 18 °F warmer", () => {
    const { out } = runPreset("two");
    expect(out.total).toBeCloseTo(122, -1);
    expect(Math.round(out.hz)).toBe(33);
    expect(out.kw).toBeCloseTo(0.9, 1);
    expect(Math.round(out.deltaT)).toBe(18);
    expect(out.lowFlow).toBe(0);
  });

  it("retrofit: 181 gpm, 41 Hz, 1.6 kW", () => {
    const { out } = runPreset("retrofit");
    expect(out.total).toBeCloseTo(181, -1);
    expect(Math.round(out.hz)).toBe(41);
    expect(out.kw).toBeCloseTo(1.6, 1);
  });

  it("mild day, three-way: still 324 gpm, back just 3 °F warmer", () => {
    const { out } = runPreset("mild-three");
    expect(out.total).toBeCloseTo(324, -1);
    expect(Math.round(out.deltaT)).toBe(3);
  });

  it("mild day, all two-way: 44 gpm, under the chiller's 105", () => {
    const { out } = runPreset("mild-two");
    expect(out.total).toBeCloseTo(44, -0.5);
    expect(out.total).toBeLessThan(LOOP.chillerMin);
    expect(out.lowFlow).toBe(1);
  });

  it("bypass wide open: AHU-1's branch takes about 140 gpm, the pump maxes out, the DP sags", () => {
    const { out } = runPreset("bypass");
    expect(Math.abs(co(out, "branchQ", 0) - 140)).toBeLessThan(10);
    expect(out.hz).toBeCloseTo(60, 0);
    expect(out.dp).toBeLessThan(out.dpSp - 0.8);
  });
});
