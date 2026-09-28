import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { bindings as coils } from "@/modules/coils/bindings";
import { bindings as economizer } from "@/modules/economizer/bindings";
import type { Outputs, RideBinding } from "../types";
import { buildAirField, type FieldMeta } from "./airField";
import { planTrip, tripTemp, TRIP_STEP } from "./ride";

function bakedField(slug: string) {
  const dir = path.join(process.cwd(), "public", "lab", slug);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "flow.json"), "utf8")) as FieldMeta;
  const q = new Int8Array(zlib.gunzipSync(fs.readFileSync(path.join(dir, meta.data))).buffer.slice(0));
  return buildAirField(meta, q, slug);
}

/** Deterministic randomness so the trips are the same every run */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const zonesOf = (ride: RideBinding<Outputs>, zone: Int16Array) => {
  const seq: string[] = [];
  for (const z of zone) if (z >= 0 && seq[seq.length - 1] !== ride.zones[z].label) seq.push(ride.zones[z].label);
  return seq;
};

describe("be the air: coils", () => {
  const f = bakedField("coils");
  const ride = coils.ride as RideBinding<Outputs>;

  it("rides from the section cut through both coils and the fan into the building", () => {
    for (let k = 0; k < 5; k++) {
      const trip = planTrip(f, 0, ride, "air", rng(k + 1))!;
      expect(trip).not.toBeNull();
      expect(ride.exits[trip.exit]?.label).toBe("Into the building");
      const seq = zonesOf(ride, trip.zone);
      const order = ["Filter", "Heating coil", "Cooling coil", "Fan", "Supply duct"].map((z) => seq.indexOf(z));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      // both coil stages crossed, heating first
      expect(trip.crossings.map((c) => f.stages[c.stage].id)).toEqual(["hw", "chw"]);
      expect(trip.length).toBeGreaterThan(4);
      expect(trip.length).toBeLessThan(12);
    }
  });

  it("takes on each coil's temperature as it crosses it", () => {
    const trip = planTrip(f, 0, ride, "air", rng(3))!;
    const temps = { hw: 70, chw: 55 } as Record<string, number>;
    const at = (s: number) => tripTemp(trip, s, 70, (k) => temps[f.stages[k].id]);
    expect(at(0)).toBe(70);
    expect(at(trip.length)).toBeCloseTo(55, 5);
  });

  it("keeps the smoothed path inside the field and evenly spaced", () => {
    const trip = planTrip(f, 0, ride, "air", rng(9))!;
    for (let k = 1; k < trip.count; k++) {
      const d = Math.hypot(trip.pts[k * 3] - trip.pts[k * 3 - 3], trip.pts[k * 3 + 1] - trip.pts[k * 3 - 2], trip.pts[k * 3 + 2] - trip.pts[k * 3 - 1]);
      expect(d).toBeLessThan(TRIP_STEP * 1.01);
    }
  });
});

describe("be the air: economizer", () => {
  const f = bakedField("economizer");
  const ride = economizer.ride as RideBinding<Outputs>;

  it("outside air always makes it into the building", () => {
    for (const pos of [0.4, 0.75]) {
      for (let k = 0; k < 4; k++) {
        const trip = planTrip(f, pos, ride, "oa", rng(k + 11))!;
        expect(ride.exits[trip.exit]?.label).toBe("Into the building");
        const seq = zonesOf(ride, trip.zone);
        expect(seq[0]).toBe("Outdoors");
        expect(seq).toContain("Outside-air damper");
        expect(seq).toContain("Mixing box");
      }
    }
  });

  it("return air sometimes leaves by the relief damper, more often the wider the dampers are open", () => {
    const reliefShare = (pos: number) => {
      let out = 0;
      const n = 30;
      for (let k = 0; k < n; k++) {
        const trip = planTrip(f, pos, ride, "ra", rng(100 + k))!;
        if (ride.exits[trip.exit]?.label === "Back outside") out++;
      }
      return out / n;
    };
    const open = reliefShare(1);
    const barely = reliefShare(0.25);
    expect(open).toBeGreaterThan(barely);
    expect(open).toBeGreaterThan(0.3);
  });
});
