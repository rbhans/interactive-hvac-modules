"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { heatLinear } from "../heat";
import { useRuntimeStore } from "../shell/runtime";
import type { FieldBinding, Outputs } from "../types";
import { collide, inField, loadAirField, sampleField, wallState, type AirField } from "./airField";

/**
 * Air as particles advected through a solved velocity field, drawn in two layers:
 *  - haze: soft, faint puffs riding the flow, so the air reads as a mass of gas tinted by its temperature
 *  - wisps: long, thin filaments through each particle's recent path, faint at both ends like smoke
 *    in a wind tunnel. No bright head and no tapering tail, so nothing reads as a swimming blob.
 * Speed still shows as wisp length, and the paths bend exactly where the air does.
 */

const K = 24; // trail samples per particle
const SAMPLE_DT = 0.035; // s between trail samples
const VIS_SCALE = 0.42; // real m/s → on-screen m/s
const MAX_SPEED = 2.2; // clamp for jets through small gaps, on-screen m/s
const LIFE = 16; // s
const MIX_TIME = 0.7; // s for a particle's color to settle to a stage's temperature after crossing its plane
const PREWARM = 8; // s of air time simulated before the first frame

const vertexShader = /* glsl */ `
  uniform sampler2D uTrail;
  uniform float uWidth;
  attribute float aK;
  attribute float aSide;
  attribute vec3 iColor;
  varying float vAlpha;
  varying float vSide;
  varying vec3 vColor;

  void main() {
    int k = int(aK);
    int row = gl_InstanceID;
    vec4 p = texelFetch(uTrail, ivec2(k, row), 0);
    vec4 pa = texelFetch(uTrail, ivec2(max(k - 1, 0), row), 0);
    vec4 pb = texelFetch(uTrail, ivec2(min(k + 1, ${K - 1}), row), 0);
    vec3 dir = pa.xyz - pb.xyz;
    if (dot(dir, dir) < 1e-10) dir = vec3(1.0, 0.0, 0.0);
    vec3 toCam = normalize(cameraPosition - p.xyz);
    vec3 side = normalize(cross(normalize(dir), toCam) + 1e-5);
    float t = aK / ${(K - 1).toFixed(1)};
    // a wisp: faint and thin at both ends, fullest a little behind the leading end
    float env = sin(3.14159265 * pow(t, 0.75));
    vec3 world = p.xyz + side * aSide * uWidth * (0.4 + 0.6 * env);
    vAlpha = p.w * env;
    vSide = aSide;
    vColor = iColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uRim;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vSide;
  varying vec3 vColor;

  void main() {
    if (vAlpha < 0.005) discard;
    float r = abs(vSide);
    // soft, gaussian cross-section: no hard edge, no highlight
    float body = exp(-r * r * 2.6);
    vec3 c = vColor * mix(uRim, 1.0, 1.0 - r * r);
    gl_FragColor = vec4(c, vAlpha * body * uOpacity);
    #include <colorspace_fragment>
  }
`;

/** Haze: one soft camera-facing puff per particle, a third of the way back along its trail. */
const hazeVertex = /* glsl */ `
  uniform sampler2D uTrail;
  uniform float uSize;
  attribute vec2 aCorner;
  attribute vec3 iColor;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec4 p = texelFetch(uTrail, ivec2(${Math.floor(K / 3)}, gl_InstanceID), 0);
    vec4 view = viewMatrix * vec4(p.xyz, 1.0);
    float r = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
    view.xy += aCorner * uSize * (0.65 + 0.7 * r);
    vUv = aCorner;
    vAlpha = p.w;
    vColor = iColor;
    gl_Position = projectionMatrix * view;
  }
`;

const hazeFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float d = dot(vUv, vUv);
    if (d > 1.0 || vAlpha < 0.005) discard;
    float a = exp(-d * 3.2) * (1.0 - d);
    gl_FragColor = vec4(vColor, a * vAlpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

/** One octave of the curl of a sinusoidal vector potential, added into out. */
function curlOctave(x: number, y: number, z: number, t: number, a: number, b: number, s: number, ph: number, out: Float32Array) {
  const t1 = t * 0.9 + ph;
  const t2 = t * 1.3 + ph * 2;
  const t3 = t * 0.7 + ph * 3;
  const dPxdy = a * Math.cos(a * y + t1) * Math.cos(b * z);
  const dPxdz = -b * Math.sin(a * y + t1) * Math.sin(b * z);
  const dPydz = a * Math.cos(a * z + t2) * Math.cos(b * x);
  const dPydx = -b * Math.sin(a * z + t2) * Math.sin(b * x);
  const dPzdx = a * Math.cos(a * x + t3) * Math.cos(b * y);
  const dPzdy = -b * Math.sin(a * x + t3) * Math.sin(b * y);
  const k = s / (a + b);
  out[0] += k * (dPzdy - dPydz);
  out[1] += k * (dPxdz - dPzdx);
  out[2] += k * (dPydx - dPxdy);
}

/** Cheap divergence-free turbulence: the curl of a sinusoidal vector potential, two octaves. */
function curl(x: number, y: number, z: number, t: number, out: Float32Array) {
  out[0] = out[1] = out[2] = 0;
  curlOctave(x, y, z, t, 4.1, 3.3, 1, 0.3, out);
  curlOctave(x, y, z, t, 7.3, 6.1, 0.3, 1.7, out);
}

interface Particles {
  max: number;
  alive: Uint8Array;
  pos: Float32Array; // Blender coords
  stream: Uint8Array;
  /** last stage plane crossed (-1: still at its source temperature), blend toward it, and the color it had when crossing */
  stage: Int8Array;
  mix: Float32Array;
  from: Float32Array;
  age: Float32Array;
  still: Float32Array;
  /** Smoothed actual velocity (on-screen m/s): what the particle really does, walls included */
  drift: Float32Array;
  trail: Float32Array; // texture data, three coords + alpha
  color: Float32Array;
  free: number[];
}

function makeParticles(max: number): Particles {
  return {
    max,
    alive: new Uint8Array(max),
    pos: new Float32Array(max * 3),
    stream: new Uint8Array(max),
    stage: new Int8Array(max),
    mix: new Float32Array(max),
    from: new Float32Array(max * 3),
    age: new Float32Array(max),
    still: new Float32Array(max),
    drift: new Float32Array(max * 3),
    trail: new Float32Array(max * K * 4),
    color: new Float32Array(max * 3),
    free: Array.from({ length: max }, (_, i) => max - 1 - i),
  };
}

function AirParticles({
  field,
  binding,
  reduced,
  dark,
  compact,
}: {
  field: AirField;
  binding: FieldBinding<Outputs>;
  reduced: boolean;
  dark: boolean;
  compact?: boolean;
}) {
  const store = useRuntimeStore();
  const group = useRef<THREE.Group>(null);
  const streams = useMemo(() => Object.keys(field.emit).filter((k) => binding.emit[k]), [field, binding]);
  const P = useMemo(() => makeParticles(compact ? 1100 : 2200), [compact]);
  const clock = useRef({
    sample: 0,
    t: 0,
    acc: new Float32Array(8),
    rateSmooth: new Float32Array(8),
    posSmooth: -1,
    /** What the particles were last pre-warmed for; with reduced motion they're rebuilt whenever it changes */
    warmKey: null as string | null,
  });
  const tmp = useMemo(
    () => ({
      v: new Float32Array(3),
      v2: new Float32Array(3),
      n: new Float32Array(3),
      p: new Float32Array(3),
      m: new Float32Array(3),
    }),
    [],
  );
  const emitPerSec = compact ? 55 : 115;

  const texture = useMemo(() => {
    const t = new THREE.DataTexture(P.trail, K, P.max, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }, [P]);

  // one color buffer shared by the wisps and the haze
  const colors = useMemo(() => {
    const col = new THREE.InstancedBufferAttribute(P.color, 3);
    col.setUsage(THREE.DynamicDrawUsage);
    return col;
  }, [P]);

  const geometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    const aK = new Float32Array(K * 2);
    const aSide = new Float32Array(K * 2);
    const index: number[] = [];
    for (let k = 0; k < K; k++) {
      aK[k * 2] = aK[k * 2 + 1] = k;
      aSide[k * 2] = -1;
      aSide[k * 2 + 1] = 1;
      if (k < K - 1) index.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    g.setIndex(index);
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(K * 2 * 3), 3));
    g.setAttribute("aK", new THREE.BufferAttribute(aK, 1));
    g.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
    g.setAttribute("iColor", colors);
    g.instanceCount = P.max;
    return g;
  }, [P, colors]);

  const hazeGeometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute("aCorner", new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setAttribute("iColor", colors);
    g.instanceCount = P.max;
    return g;
  }, [P, colors]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTrail: { value: texture },
          uWidth: { value: 0.0075 },
          uRim: { value: 0.8 },
          uOpacity: { value: 0.5 },
        },
      }),
    [texture],
  );

  const hazeMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: hazeVertex,
        fragmentShader: hazeFragment,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTrail: { value: texture },
          uSize: { value: compact ? 0.2 : 0.17 },
          uOpacity: { value: compact ? 0.09 : 0.065 },
        },
      }),
    [texture, compact],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      hazeGeometry.dispose();
      material.dispose();
      hazeMaterial.dispose();
      texture.dispose();
    },
    [geometry, hazeGeometry, material, hazeMaterial, texture],
  );

  /** Each stream's entering color (linear RGB) */
  const streamColors = (o: Outputs) => streams.map((s) => heatLinear(binding.tempF[s]?.(o) ?? 70));

  /** A new particle in stream s's emit box, already wearing its stream's color */
  const spawn = (s: number, color: [number, number, number]) => {
    const i = P.free.pop();
    if (i === undefined) return;
    const box = field.emit[streams[s]];
    const x = box.lo[0] + Math.random() * (box.hi[0] - box.lo[0]);
    const y = box.lo[1] + Math.random() * (box.hi[1] - box.lo[1]);
    const z = box.lo[2] + Math.random() * (box.hi[2] - box.lo[2]);
    P.alive[i] = 1;
    P.pos[i * 3] = x;
    P.pos[i * 3 + 1] = y;
    P.pos[i * 3 + 2] = z;
    P.stream[i] = s;
    P.stage[i] = -1;
    P.mix[i] = 0;
    P.age[i] = Math.random() * 0.1;
    P.still[i] = 0;
    for (let c = 0; c < 3; c++) {
      P.drift[i * 3 + c] = 0;
      P.color[i * 3 + c] = color[c];
      P.from[i * 3 + c] = color[c];
    }
    for (let k = 0; k < K; k++) {
      const r = (i * K + k) * 4;
      P.trail[r] = x;
      P.trail[r + 1] = z;
      P.trail[r + 2] = -y;
      P.trail[r + 3] = 0;
    }
  };

  const kill = (i: number) => {
    P.alive[i] = 0;
    P.free.push(i);
    for (let k = 0; k < K; k++) P.trail[(i * K + k) * 4 + 3] = 0;
  };

  const alphaOf = (i: number) => Math.min(1, P.age[i] / 0.35) * Math.min(1, (LIFE - P.age[i]) / 1) * Math.max(0, 1 - P.still[i] / 1.2);

  /** Newest trail sample = the particle's current position (three.js axes) and fade. */
  const writeHead = (i: number) => {
    const row = i * K * 4;
    P.trail[row] = P.pos[i * 3];
    P.trail[row + 1] = P.pos[i * 3 + 2];
    P.trail[row + 2] = -P.pos[i * 3 + 1];
    P.trail[row + 3] = alphaOf(i);
  };

  /** Particle colors: each stream's own temperature, then each stage's once crossed. */
  const paint = (o: Outputs) => {
    const cols = streamColors(o);
    const stageCols = field.stages.map((st) => heatLinear(binding.stages[st.id]?.(o) ?? 70));

    for (let i = 0; i < P.max; i++) {
      if (!P.alive[i]) continue;
      const st = P.stage[i];
      if (st < 0) {
        const src = cols[P.stream[i]];
        P.color[i * 3] = src[0];
        P.color[i * 3 + 1] = src[1];
        P.color[i * 3 + 2] = src[2];
      } else {
        const to = stageCols[st];
        const w = P.mix[i];
        P.color[i * 3] = P.from[i * 3] + (to[0] - P.from[i * 3]) * w;
        P.color[i * 3 + 1] = P.from[i * 3 + 1] + (to[1] - P.from[i * 3 + 1]) * w;
        P.color[i * 3 + 2] = P.from[i * 3 + 2] + (to[2] - P.from[i * 3 + 2]) * w;
      }
    }
  };

  /** Advance emission, advection and trails by dt seconds of air time. */
  const simulate = (dt: number, o: Outputs) => {
    if (!(dt > 0)) return;
    const c = clock.current;
    c.t += dt;
    // emission, proportional to each stream's share of the airflow
    const cols = streamColors(o);
    streams.forEach((s, k) => {
      const rate = Math.min(1.2, Math.max(0, binding.emit[s](o)));
      c.rateSmooth[k] += (rate - c.rateSmooth[k]) * (1 - Math.exp(-dt / 0.35));
      c.acc[k] += c.rateSmooth[k] * emitPerSec * dt;
      while (c.acc[k] >= 1) {
        c.acc[k] -= 1;
        spawn(k, cols[k]);
      }
    });

    // the field's velocities scaled to the airflow right now (a VAV box runs from a trickle to full)
    const vis = VIS_SCALE * Math.min(2, Math.max(0.1, binding.speed?.(o) ?? 1));
    // advect: RK2 through the field plus a little turbulence, sub-stepped so nothing jumps a wall
    const maxStep = field.h * 0.45;
    const walls = wallState(field, c.posSmooth);
    const kDrift = 1 - Math.exp(-dt / 0.5);
    for (let i = 0; i < P.max; i++) {
      if (!P.alive[i]) continue;
      const x0 = P.pos[i * 3];
      const y0 = P.pos[i * 3 + 1];
      const z0 = P.pos[i * 3 + 2];
      let x = x0;
      let y = y0;
      let z = z0;
      sampleField(field, c.posSmooth, walls, x, y, z, tmp.v);
      const speed = Math.hypot(tmp.v[0], tmp.v[1], tmp.v[2]) * vis;
      const subs = Math.min(6, Math.max(1, Math.ceil((Math.min(speed, MAX_SPEED) * dt) / maxStep)));
      const h = dt / subs;
      for (let sI = 0; sI < subs; sI++) {
        sampleField(field, c.posSmooth, walls, x, y, z, tmp.v);
        const s1 = Math.hypot(tmp.v[0], tmp.v[1], tmp.v[2]) * vis;
        const k1 = s1 > MAX_SPEED ? (MAX_SPEED / s1) * vis : vis;
        tmp.m[0] = x + tmp.v[0] * k1 * h * 0.5;
        tmp.m[1] = y + tmp.v[1] * k1 * h * 0.5;
        tmp.m[2] = z + tmp.v[2] * k1 * h * 0.5;
        // the midpoint can't reach past a wall either, or it would sample the air on the other side
        collide(field, walls, x, y, z, tmp.m);
        sampleField(field, c.posSmooth, walls, tmp.m[0], tmp.m[1], tmp.m[2], tmp.v2);
        const s2 = Math.hypot(tmp.v2[0], tmp.v2[1], tmp.v2[2]) * vis;
        const k2 = s2 > MAX_SPEED ? (MAX_SPEED / s2) * vis : vis;
        curl(x, y, z, c.t, tmp.n);
        const turb = 0.02 + 0.08 * Math.min(s2, MAX_SPEED);
        tmp.p[0] = x + (tmp.v2[0] * k2 + tmp.n[0] * turb) * h;
        tmp.p[1] = y + (tmp.v2[1] * k2 + tmp.n[1] * turb) * h;
        tmp.p[2] = z + (tmp.v2[2] * k2 + tmp.n[2] * turb) * h;
        // air can't go through walls, and neither can turbulence
        collide(field, walls, x, y, z, tmp.p);
        x = tmp.p[0];
        y = tmp.p[1];
        z = tmp.p[2];
      }
      P.pos[i * 3] = x;
      P.pos[i * 3 + 1] = y;
      P.pos[i * 3 + 2] = z;
      P.age[i] += dt;
      // still = hardly getting anywhere, judged by where it actually went: a particle the field pins
      // against a wall has plenty of field speed but no movement, and should fade out, not hang there
      P.drift[i * 3] += ((x - x0) / dt - P.drift[i * 3]) * kDrift;
      P.drift[i * 3 + 1] += ((y - y0) / dt - P.drift[i * 3 + 1]) * kDrift;
      P.drift[i * 3 + 2] += ((z - z0) / dt - P.drift[i * 3 + 2]) * kDrift;
      const moved = Math.hypot(P.drift[i * 3], P.drift[i * 3 + 1], P.drift[i * 3 + 2]);
      P.still[i] = moved < 0.03 ? P.still[i] + dt : Math.max(0, P.still[i] - dt);
      // crossing the next stage plane (going downstream): start blending from the current color toward that
      // stage's temperature. Only an actual crossing counts: air that enters beyond a plane (return air in the
      // roof duct, past the mixing plane) keeps its own temperature until it comes back around and crosses it.
      while (P.stage[i] + 1 < field.stages.length && x0 <= field.stages[P.stage[i] + 1].x && x > field.stages[P.stage[i] + 1].x) {
        P.stage[i]++;
        P.mix[i] = 0;
        P.from[i * 3] = P.color[i * 3];
        P.from[i * 3 + 1] = P.color[i * 3 + 1];
        P.from[i * 3 + 2] = P.color[i * 3 + 2];
      }
      if (P.stage[i] >= 0) P.mix[i] = Math.min(1, P.mix[i] + dt / MIX_TIME);
      if (!inField(field, x, y, z) || P.age[i] > LIFE || P.still[i] > 1.2) kill(i);
      else writeHead(i);
    }

    // trails: shift one sample back every SAMPLE_DT
    c.sample += dt;
    if (c.sample >= SAMPLE_DT) {
      c.sample %= SAMPLE_DT;
      for (let i = 0; i < P.max; i++) {
        if (!P.alive[i]) continue;
        const row = i * K * 4;
        P.trail.copyWithin(row + 4, row, row + (K - 1) * 4);
      }
    }
    paint(o);
  };

  useFrame((_, delta) => {
    const m = group.current;
    if (!m) return;
    const st = store.getState();
    m.visible = st.view.flow && !st.view.exploded;
    if (!m.visible) return;
    const o = st.outputs;
    const dt = Math.min(delta, 0.05);
    const c = clock.current;
    material.uniforms.uRim.value = dark ? 0.8 : 0.5;

    // blend fields toward the physical damper position without snapping
    const target = Math.min(1, Math.max(0, binding.position(o)));
    c.posSmooth = c.posSmooth < 0 || reduced ? target : c.posSmooth + (target - c.posSmooth) * (1 - Math.exp(-dt / 0.25));

    // open with the unit already full of air: fast-forward a few seconds before the first frame. With reduced
    // motion the particles never move on screen, so rebuild that still picture whenever the airflow changes.
    const warmKey = reduced
      ? `${Math.round(target * 40)}|${streams.map((s) => Math.round(Math.min(1.2, Math.max(0, binding.emit[s](o))) * 20)).join(",")}`
      : "live";
    if (c.warmKey !== warmKey) {
      if (c.warmKey !== null) for (let i = 0; i < P.max; i++) if (P.alive[i]) kill(i);
      c.warmKey = warmKey;
      for (let t = 0; t < PREWARM; t += 0.05) simulate(0.05, o);
    }
    // simulate() paints as it goes; otherwise repaint so paused air still follows the temperatures
    if (st.running && !reduced) simulate(dt, o);
    else paint(o);
    texture.needsUpdate = true;
    colors.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <mesh geometry={hazeGeometry} material={hazeMaterial} frustumCulled={false} renderOrder={2} />
      <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />
    </group>
  );
}

/** Loads the module's baked field; renders `fallback` (path-following streaks) if there isn't one. */
export function AirFlow({
  binding,
  reduced,
  dark,
  compact,
  fallback,
}: {
  binding: FieldBinding<Outputs>;
  reduced: boolean;
  dark: boolean;
  compact?: boolean;
  fallback: ReactNode;
}) {
  const [field, setField] = useState<AirField | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadAirField(binding.url)
      .then((f) => live && setField(f))
      .catch((e) => {
        console.warn("[lab] airflow field unavailable, using path streaks:", e);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [binding.url]);
  if (failed) return <>{fallback}</>;
  if (!field) return null;
  return <AirParticles field={field} binding={binding} reduced={reduced} dark={dark} compact={compact} />;
}
