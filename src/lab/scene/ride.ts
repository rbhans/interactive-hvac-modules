/**
 * "Be the air": plan a first-person trip through a solved airflow field.
 *
 * A trip is one real path: a seed point in an inlet, carried through the field with the same
 * wall-aware stepping the particles use (minus their decorative turbulence), resampled to even
 * spacing and lightly smoothed so a camera can ride it. Everything here is in Blender axes.
 */
import type { RideBinding, RideBox } from "../types";
import { collide, inField, sampleField, wallState, type AirField } from "./airField";

/** Spacing of the resampled path, m */
export const TRIP_STEP = 0.04;

export interface Trip {
  /** Resampled, smoothed path, Blender coords, TRIP_STEP apart */
  pts: Float32Array;
  /** Real air speed at each point, m/s */
  speed: Float32Array;
  /** Index into ride.zones at each point, -1 where none matches */
  zone: Int16Array;
  count: number;
  length: number;
  /** Stage planes crossed going downstream, in order: index into field.stages, and distance along the path */
  crossings: { stage: number; at: number }[];
  /** Index into ride.exits for where the path left the field; -1 if it never did */
  exit: number;
}

const inBox = (b: RideBox, x: number, y: number, z: number) =>
  x >= b.lo[0] && x <= b.hi[0] && y >= b.lo[1] && y <= b.hi[1] && z >= b.lo[2] && z <= b.hi[2];

/** Carry a point through the field. Returns the raw path, the air speed along it, and whether it left the field. */
export function tracePath(f: AirField, pos: number, seed: [number, number, number], maxLength = 40) {
  const walls = wallState(f, pos);
  const v = new Float32Array(3);
  const v2 = new Float32Array(3);
  const m = new Float32Array(3);
  const p = new Float32Array(3);
  let [x, y, z] = seed;
  const pts: number[] = [x, y, z];
  const speed: number[] = [];
  let travelled = 0;
  let sinceRecord = 0;
  let left = false;
  // stuck: less than 2 cm of net progress over 2 s of air time (pinned in a corner or a dead zone)
  let anchor = [x, y, z];
  let anchorT = 0;
  let t = 0;
  sampleField(f, pos, walls, x, y, z, v);
  speed.push(Math.hypot(v[0], v[1], v[2]));
  for (let step = 0; step < 60000 && travelled < maxLength; step++) {
    sampleField(f, pos, walls, x, y, z, v);
    const s = Math.hypot(v[0], v[1], v[2]);
    const h = Math.min(0.05, Math.max(0.002, (f.h * 0.4) / Math.max(s, 0.05)));
    m[0] = x + v[0] * h * 0.5;
    m[1] = y + v[1] * h * 0.5;
    m[2] = z + v[2] * h * 0.5;
    collide(f, walls, x, y, z, m);
    sampleField(f, pos, walls, m[0], m[1], m[2], v2);
    p[0] = x + v2[0] * h;
    p[1] = y + v2[1] * h;
    p[2] = z + v2[2] * h;
    collide(f, walls, x, y, z, p);
    const d = Math.hypot(p[0] - x, p[1] - y, p[2] - z);
    x = p[0];
    y = p[1];
    z = p[2];
    t += h;
    travelled += d;
    sinceRecord += d;
    if (!inField(f, x, y, z)) {
      pts.push(x, y, z);
      speed.push(Math.hypot(v2[0], v2[1], v2[2]));
      left = true;
      break;
    }
    if (sinceRecord >= 0.01) {
      sinceRecord = 0;
      pts.push(x, y, z);
      speed.push(Math.hypot(v2[0], v2[1], v2[2]));
    }
    if (t - anchorT > 2) {
      if (Math.hypot(x - anchor[0], y - anchor[1], z - anchor[2]) < 0.02) break;
      anchor = [x, y, z];
      anchorT = t;
    }
  }
  return { pts, speed, left };
}

/** Resample a polyline to even spacing, then smooth it a little (the ends stay put). */
function resample(pts: number[], speed: number[]) {
  const n = pts.length / 3;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]));
  const total = cum[n - 1];
  const count = Math.max(2, Math.floor(total / TRIP_STEP) + 1);
  const out = new Float32Array(count * 3);
  const sp = new Float32Array(count);
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = Math.min(total, k * TRIP_STEP);
    while (j < n - 2 && cum[j + 1] < s) j++;
    const span = cum[j + 1] - cum[j] || 1;
    const w = Math.min(1, Math.max(0, (s - cum[j]) / span));
    for (let a = 0; a < 3; a++) out[k * 3 + a] = pts[j * 3 + a] + (pts[(j + 1) * 3 + a] - pts[j * 3 + a]) * w;
    sp[k] = speed[j] + (speed[j + 1] - speed[j]) * w;
  }
  // two passes of a ±3-sample moving average (about ±12 cm): irons out the stair-steps where the path
  // slid along a wall face, without cutting corners enough to leave the channel
  let cur = out;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(cur);
    for (let k = 1; k < count - 1; k++) {
      const r = Math.min(3, k, count - 1 - k);
      for (let a = 0; a < 3; a++) {
        let acc = 0;
        for (let d = -r; d <= r; d++) acc += cur[(k + d) * 3 + a];
        next[k * 3 + a] = acc / (2 * r + 1);
      }
    }
    cur = next;
  }
  return { pts: cur, speed: sp, count, raw: out };
}

/**
 * Plan a trip from one of the ride's starts. Where you end up is decided honestly: a seed from
 * anywhere across the inlet, so return air lands in the relief damper's streamtube exactly as often
 * as real return air does. The ride itself then follows a path nearer the middle of the inlet with
 * the same fate, so the camera isn't scraping along a wall the whole way.
 */
export function planTrip<O>(f: AirField, pos: number, ride: RideBinding<O>, startId: string, rng: () => number = Math.random): Trip | null {
  const start = ride.starts.find((s) => s.id === startId);
  const box = start && f.emit[start.emit];
  if (!box) return null;
  const seed = (margin: number): [number, number, number] => {
    const pick = (a: number) => {
      const m = Math.min(margin, (box.hi[a] - box.lo[a]) * 0.3);
      return box.lo[a] + m + rng() * (box.hi[a] - box.lo[a] - 2 * m);
    };
    return [box.lo[0] + rng() * (box.hi[0] - box.lo[0]), pick(1), pick(2)];
  };
  const fate = (r: ReturnType<typeof tracePath>) => {
    if (!r.left) return -1;
    const n = r.pts.length;
    return ride.exits.findIndex((b) => inBox(b, r.pts[n - 3], r.pts[n - 2], r.pts[n - 1]));
  };

  // the honest draw decides the destination
  let best: ReturnType<typeof tracePath> | null = null;
  for (let attempt = 0; attempt < 6 && !best?.left; attempt++) {
    const r = tracePath(f, pos, seed(0.02));
    if (!best || r.left || r.pts.length > best.pts.length) best = r;
  }
  if (!best) return null;
  const want = fate(best);
  // then a path through the middle of the inlet that ends up in the same place
  for (let attempt = 0; attempt < 10 && want >= 0; attempt++) {
    const r = tracePath(f, pos, seed(0.14));
    if (r.pts.length / 3 > 20 && fate(r) === want) {
      best = r;
      break;
    }
  }
  if (!best || best.pts.length < 6) return null;

  const { pts, speed, count, raw } = resample(best.pts, best.speed);
  const zone = new Int16Array(count);
  for (let k = 0; k < count; k++) {
    const [x, y, z] = [raw[k * 3], raw[k * 3 + 1], raw[k * 3 + 2]];
    zone[k] = ride.zones.findIndex((b) => inBox(b, x, y, z));
  }
  // stage planes, crossed in order and only going downstream (the particles' rule)
  const crossings: Trip["crossings"] = [];
  let next = 0;
  for (let k = 1; k < count && next < f.stages.length; k++) {
    const x0 = raw[(k - 1) * 3];
    const x1 = raw[k * 3];
    while (next < f.stages.length && x0 <= f.stages[next].x && x1 > f.stages[next].x) crossings.push({ stage: next++, at: k * TRIP_STEP });
  }
  const end = best.pts.slice(-3) as [number, number, number];
  const exit = best.left ? ride.exits.findIndex((b) => inBox(b, end[0], end[1], end[2])) : -1;
  return { pts, speed, zone, count, length: (count - 1) * TRIP_STEP, crossings, exit };
}

/** Position on the trip at distance s, written into out (Blender coords). */
export function tripPoint(trip: Trip, s: number, out: Float32Array) {
  const f = Math.min(trip.count - 1.0001, Math.max(0, s / TRIP_STEP));
  const i = Math.floor(f);
  const w = f - i;
  for (let a = 0; a < 3; a++) out[a] = trip.pts[i * 3 + a] + (trip.pts[(i + 1) * 3 + a] - trip.pts[i * 3 + a]) * w;
  return out;
}

export const tripIndex = (trip: Trip, s: number) => Math.min(trip.count - 1, Math.max(0, Math.round(s / TRIP_STEP)));

/**
 * Air temperature at distance s: the stream's own, then each stage's, blended over the 15 cm past its plane.
 * Stage planes sit mid-coil, so you leave each coil at its leaving temperature, as the sensor after it reads.
 */
export function tripTemp(trip: Trip, s: number, source: number, stageTemp: (stage: number) => number) {
  let t = source;
  for (const c of trip.crossings) {
    if (s < c.at) break;
    const k = Math.min(1, (s - c.at) / 0.15);
    t += (stageTemp(c.stage) - t) * k;
  }
  return t;
}
