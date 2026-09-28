import { describe, expect, it } from "vitest";
import { collide, sampleField, type AirField, type AirFieldState } from "./airField";

/** A 4×1×1 duct of 1 m cells along x, every y/z face a wall, x faces open unless listed. */
function state(pos: number, ux: number[], walls: number[] = []): AirFieldState {
  const wx = new Uint8Array(5);
  for (const k of walls) wx[k] = 1;
  return {
    pos,
    ux: Float32Array.from(ux, (v, k) => (wx[k] ? 0 : v)),
    uy: new Float32Array(8),
    uz: new Float32Array(8),
    wx,
    wy: new Uint8Array(8).fill(1),
    wz: new Uint8Array(8).fill(1),
  };
}

const field = (states: AirFieldState[]): AirField => ({ n: [4, 1, 1], lo: [0, 0, 0], h: 1, states, emit: {}, stages: [] });

describe("collide", () => {
  it("stops a long step at a wall it would otherwise hop over", () => {
    const f = field([state(0, [1, 1, 1, 1, 1], [2])]);
    // from cell 0 to cell 3 in one step: the wall is the face between cells 1 and 2
    const p = Float32Array.of(3.5, 0.5, 0.5);
    collide(f, f.states[0], 0.5, 0.5, 0.5, p);
    expect(p[0]).toBeCloseTo(1.999, 6);
  });

  it("lets a long step through open faces", () => {
    const f = field([state(0, [1, 1, 1, 1, 1])]);
    const p = Float32Array.of(3.5, 0.5, 0.5);
    collide(f, f.states[0], 0.5, 0.5, 0.5, p);
    expect(p[0]).toBe(3.5);
  });
});

describe("sampleField", () => {
  it("closes faces that are walls in the wall state, even when blending with a state that has them open", () => {
    const shut = state(0, [0, 2, 2, 0, 0], [2]);
    const open = state(1, [0, 2, 2, 2, 0]);
    const f = field([shut, open]);
    const out = new Float32Array(3);
    // right against the wall face (x = 2), halfway between the two states
    sampleField(f, 0.5, shut, 1.999, 0.5, 0.5, out);
    expect(out[0]).toBeCloseTo(0.002, 3);
    // with the open state's walls, the blend carries its flow through
    sampleField(f, 0.5, open, 1.999, 0.5, 0.5, out);
    expect(out[0]).toBeCloseTo(1.001, 3);
  });
});
