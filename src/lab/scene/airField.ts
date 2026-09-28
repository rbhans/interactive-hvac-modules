/**
 * Loads a baked airflow field (blender/sims → flow.json + flow.bin.gz) and moves points
 * through it. Everything here is in Blender's Z-up axes, the space the field was solved in.
 *
 * Velocities live on cell faces (a staggered grid), which is what the solver computes.
 * A point only ever reads the six faces of the cell it's in, so it never picks up velocity
 * from the far side of a wall. Faces that are walls are stored too, and `collide` stops
 * points from crossing them, exactly as the bake-time tracer does.
 */

export interface AirFieldState {
  pos: number;
  ux: Float32Array; // (nx+1, ny, nz), x fastest
  uy: Float32Array; // (nx, ny+1, nz)
  uz: Float32Array; // (nx, ny, nz+1)
  wx: Uint8Array; // 1 = wall face
  wy: Uint8Array;
  wz: Uint8Array;
}

export interface AirField {
  n: [number, number, number];
  lo: [number, number, number];
  h: number;
  states: AirFieldState[];
  emit: Record<string, { lo: [number, number, number]; hi: [number, number, number] }>;
  /** Planes (Blender x) where air takes on a new temperature, in the order air reaches them */
  stages: { id: string; x: number }[];
}

export interface FieldMeta {
  version: number;
  layout: string;
  n: [number, number, number];
  lo: [number, number, number];
  h: number;
  data: string;
  states: { pos: number; vmax: number; ux: number; uy: number; uz: number }[];
  emit: AirField["emit"];
  stages?: { id: string; x: number }[];
  /** v2 files before stages existed */
  mixPlaneX?: number;
}

const WALL = -128;

async function inflate(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(buf);
  // the server may already have decoded it (Content-Encoding); only inflate real gzip
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return buf;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function decode(q: Int8Array, offset: number, count: number, vmax: number) {
  const u = new Float32Array(count);
  const wall = new Uint8Array(count);
  for (let k = 0; k < count; k++) {
    const v = q[offset + k];
    if (v === WALL) {
      wall[k] = 1;
      continue;
    }
    const s = v / 127;
    u[k] = Math.sign(s) * s * s * vmax; // undo sqrt companding
  }
  return { u, wall };
}

const cache = new Map<string, Promise<AirField>>();

export function loadAirField(url: string): Promise<AirField> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const meta: FieldMeta = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return r.json();
      });
      const dataUrl = new URL(meta.data, new URL(url, window.location.href)).toString();
      const raw = await fetch(dataUrl).then((r) => {
        if (!r.ok) throw new Error(`${dataUrl}: ${r.status}`);
        return r.arrayBuffer();
      });
      return buildAirField(meta, new Int8Array(await inflate(raw)), dataUrl);
    })();
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

/** Decode a field file's header and inflated data. Kept apart from the fetching so tests can read the baked files. */
export function buildAirField(meta: FieldMeta, q: Int8Array, label = "flow data"): AirField {
  if (meta.layout !== "staggered") throw new Error(`${label}: unsupported layout ${meta.layout}`);
  const [nx, ny, nz] = meta.n;
  // a short or mismatched file would decode to NaN velocities and freeze every particle; fail so the fallback streaks run
  for (const s of meta.states) {
    const spans: [number, number][] = [
      [s.ux, (nx + 1) * ny * nz],
      [s.uy, nx * (ny + 1) * nz],
      [s.uz, nx * ny * (nz + 1)],
    ];
    for (const [offset, count] of spans) {
      if (!(offset >= 0) || offset + count > q.length) throw new Error(`${label}: ${q.length} bytes, too short for state ${s.pos}`);
    }
  }
  const states = meta.states
    .map((s) => {
      const x = decode(q, s.ux, (nx + 1) * ny * nz, s.vmax);
      const y = decode(q, s.uy, nx * (ny + 1) * nz, s.vmax);
      const z = decode(q, s.uz, nx * ny * (nz + 1), s.vmax);
      return { pos: s.pos, ux: x.u, uy: y.u, uz: z.u, wx: x.wall, wy: y.wall, wz: z.wall };
    })
    .sort((a, b) => a.pos - b.pos);
  const stages = (meta.stages ?? (meta.mixPlaneX !== undefined ? [{ id: "mix", x: meta.mixPlaneX }] : [])).slice().sort((a, b) => a.x - b.x);
  return { n: meta.n, lo: meta.lo, h: meta.h, states, emit: meta.emit, stages };
}

const clampi = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Velocity inside the point's own cell, linear between opposite faces; weighted into out.
 * Faces that are walls in `walls` (the state particles collide with) carry no flow, even where
 * this state has them open, so a blend between states never pushes air into a wall it can't pass.
 */
function sampleState(f: AirField, s: AirFieldState, walls: AirFieldState, x: number, y: number, z: number, w: number, out: Float32Array) {
  const [nx, ny, nz] = f.n;
  const gx = (x - f.lo[0]) / f.h;
  const gy = (y - f.lo[1]) / f.h;
  const gz = (z - f.lo[2]) / f.h;
  const i = clampi(Math.floor(gx), 0, nx - 1);
  const j = clampi(Math.floor(gy), 0, ny - 1);
  const k = clampi(Math.floor(gz), 0, nz - 1);
  const fx = Math.min(1, Math.max(0, gx - i));
  const fy = Math.min(1, Math.max(0, gy - j));
  const fz = Math.min(1, Math.max(0, gz - k));
  const ix = (k * ny + j) * (nx + 1) + i;
  const iy = (k * (ny + 1) + j) * nx + i;
  const iz = (k * ny + j) * nx + i;
  const iz1 = iz + nx * ny;
  const x0 = walls.wx[ix] ? 0 : s.ux[ix];
  const x1 = walls.wx[ix + 1] ? 0 : s.ux[ix + 1];
  const y0 = walls.wy[iy] ? 0 : s.uy[iy];
  const y1 = walls.wy[iy + nx] ? 0 : s.uy[iy + nx];
  const z0 = walls.wz[iz] ? 0 : s.uz[iz];
  const z1 = walls.wz[iz1] ? 0 : s.uz[iz1];
  out[0] += w * (x0 * (1 - fx) + x1 * fx);
  out[1] += w * (y0 * (1 - fy) + y1 * fy);
  out[2] += w * (z0 * (1 - fz) + z1 * fz);
}

/**
 * Velocity at a point for a position between baked states (linear blend of the two nearest),
 * with `walls` (see `wallState`) closed.
 */
export function sampleField(f: AirField, pos: number, walls: AirFieldState, x: number, y: number, z: number, out: Float32Array) {
  out[0] = out[1] = out[2] = 0;
  const s = f.states;
  if (pos <= s[0].pos) return sampleState(f, s[0], walls, x, y, z, 1, out);
  if (pos >= s[s.length - 1].pos) return sampleState(f, s[s.length - 1], walls, x, y, z, 1, out);
  let i = 0;
  while (i < s.length - 2 && pos > s[i + 1].pos) i++;
  const w = (pos - s[i].pos) / (s[i + 1].pos - s[i].pos);
  sampleState(f, s[i], walls, x, y, z, 1 - w, out);
  sampleState(f, s[i + 1], walls, x, y, z, w, out);
}

/** The baked state whose walls apply at this position (the nearest one). */
export function wallState(f: AirField, pos: number): AirFieldState {
  let best = f.states[0];
  for (const s of f.states) if (Math.abs(s.pos - pos) < Math.abs(best.pos - pos)) best = s;
  return best;
}

/**
 * Stop a move from (ox, oy, oz) to p at wall faces. Resolved one axis at a time with the cell
 * updated in between, so a diagonal step can't slip between two walls that meet at a corner,
 * and one face at a time along each axis, so a long step can't hop over a wall.
 * Moves out through an opening are allowed (the caller retires points that leave the field).
 * Mutates p.
 */
export function collide(f: AirField, s: AirFieldState, ox: number, oy: number, oz: number, p: Float32Array) {
  const [nx, ny, nz] = f.n;
  const n = f.n;
  const cur = [Math.floor((ox - f.lo[0]) / f.h), Math.floor((oy - f.lo[1]) / f.h), Math.floor((oz - f.lo[2]) / f.h)];
  for (let ax = 0; ax < 3; ax++) {
    const to = Math.floor((p[ax] - f.lo[ax]) / f.h);
    if (!Number.isFinite(to) || !Number.isFinite(cur[ax])) continue;
    const dir = to > cur[ax] ? 1 : -1;
    while (cur[ax] !== to) {
      const next = cur[ax] + dir;
      const face = clampi(Math.max(cur[ax], next), 0, n[ax]);
      const i = ax === 0 ? face : clampi(cur[0], 0, nx - 1);
      const j = ax === 1 ? face : clampi(cur[1], 0, ny - 1);
      const k = ax === 2 ? face : clampi(cur[2], 0, nz - 1);
      const wall =
        ax === 0 ? s.wx[(k * ny + j) * (nx + 1) + i] : ax === 1 ? s.wy[(k * (ny + 1) + j) * nx + i] : s.wz[(k * ny + j) * nx + i];
      if (wall) {
        p[ax] = f.lo[ax] + (cur[ax] + (dir > 0 ? 0.999 : 0.001)) * f.h;
        break;
      }
      cur[ax] = next;
    }
  }
}

export function inField(f: AirField, x: number, y: number, z: number) {
  return (
    x > f.lo[0] && x < f.lo[0] + f.n[0] * f.h && y > f.lo[1] && y < f.lo[1] + f.n[1] * f.h && z > f.lo[2] && z < f.lo[2] + f.n[2] * f.h
  );
}
