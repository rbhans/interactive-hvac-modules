"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { heatLinear } from "../heat";
import { useRuntimeStore } from "../shell/runtime";
import type { FlowBinding, Outputs } from "../types";
import type { FlowPath } from "./sceneIndex";

/**
 * Flow as soft streaks: each particle is a camera-facing ribbon whose leading end sits at
 * its phase along the path and whose body bends back along the same curve, faint at both ends. The curve
 * lives in a small float texture, so the bending happens in the vertex shader and
 * the CPU only advances one number per particle.
 */

const LUT = 256;
const SEGMENTS = 16;
const ACROSS = new THREE.Vector3(0, 0, 1); // world depth (Blender Y)

const vertexShader = /* glsl */ `
  uniform sampler2D uLut;
  uniform float uLutW;
  uniform float uTrail;
  uniform float uWidth;
  uniform float uRate;
  uniform float uEdge;
  uniform float uLift;

  attribute float aT;
  attribute float aSide;
  attribute float iPhase;
  attribute vec2 iOffset;
  attribute vec4 iMeta; // x speed, y visibility threshold, z tint, w trail-length factor

  varying float vAlpha;
  varying float vSide;
  varying float vT;
  varying float vTint;

  vec4 lut(float u, int row) {
    float x = clamp(u, 0.0, 1.0) * (uLutW - 1.0);
    int i0 = int(floor(x));
    int i1 = min(i0 + 1, int(uLutW) - 1);
    return mix(texelFetch(uLut, ivec2(i0, row), 0), texelFetch(uLut, ivec2(i1, row), 0), x - float(i0));
  }

  void main() {
    float u = iPhase - aT * uTrail * iMeta.w;
    vec4 p = lut(u, 0);
    vec4 n = lut(u, 1);
    vec3 t = normalize(lut(u, 2).xyz);

    vec3 local = p.xyz + lut(u, 3).xyz * iOffset.x * p.w + n.xyz * iOffset.y * n.w;
    vec4 world = modelMatrix * vec4(local, 1.0);
    vec3 toCam = normalize(cameraPosition - world.xyz);
    // water runs inside opaque pipes: slide it along the view ray to the pipe's near surface.
    // That changes only depth, never where it lands on screen, so it stays inside the pipe's outline.
    world.xyz += toCam * uLift;
    vec3 side = normalize(cross(t, toCam) + 1e-5);
    // soft at both ends, no bright head: a dash of flow, not a comet
    float env = sin(3.14159265 * pow(aT, 0.75));
    world.xyz += side * aSide * uWidth * (0.4 + 0.6 * env);

    float inside = step(0.0, u) * step(u, 1.0);
    float ends = smoothstep(0.0, uEdge, u) * (1.0 - smoothstep(1.0 - uEdge, 1.0, u));
    float vis = clamp((uRate - iMeta.y) * 12.0, 0.0, 1.0);
    vAlpha = env * ends * inside * vis;
    vSide = aSide;
    vT = aT;
    vTint = iMeta.z;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uRim;

  varying float vAlpha;
  varying float vSide;
  varying float vT;
  varying float vTint;

  void main() {
    float r = abs(vSide);
    float body = exp(-r * r * 2.6);
    // a slightly darker rim gives each streak body, so pale air still reads on light surfaces
    vec3 c = uColor * vTint * mix(uRim, 1.0, 1.0 - r * r);
    gl_FragColor = vec4(c, vAlpha * body * uOpacity);
    #include <colorspace_fragment>
  }
`;

interface Stream {
  id: string;
  binding: FlowBinding<Outputs>;
  length: number;
  count: number;
  lut: THREE.DataTexture;
  geometry: THREE.InstancedBufferGeometry;
  phase: THREE.InstancedBufferAttribute;
  speed: Float32Array;
  trail: number;
}

function buildStream(path: FlowPath, binding: FlowBinding<Outputs>, density: number): Stream {
  const curve = new THREE.CatmullRomCurve3(path.points, false, "centripetal", 0.5);
  const length = curve.getLength();

  // LUT rows: 0 = position + across-spread, 1 = in-plane normal + normal-spread, 2 = tangent, 3 = across axis
  const data = new Float32Array(LUT * 4 * 4);
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  const a = new THREE.Vector3();
  const last = path.points.length - 1;
  for (let k = 0; k < LUT; k++) {
    const u = k / (LUT - 1);
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    // "across" is world depth, squared off against the path; a path running along the depth axis
    // (a duct seen end-on) spreads across world x instead, or its particles would line up along it
    a.copy(ACROSS).addScaledVector(t, -t.dot(ACROSS));
    if (a.lengthSq() < 0.05) a.set(1, 0, 0).addScaledVector(t, -t.x);
    a.normalize();
    n.crossVectors(t, a);
    if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
    n.normalize();
    const f = curve.getUtoTmapping(u, 0) * last;
    const i0 = Math.min(last - 1, Math.floor(f));
    const w = f - i0;
    const s0 = path.spreads[i0];
    const s1 = path.spreads[Math.min(last, i0 + 1)];
    data.set([p.x, p.y, p.z, s0[0] + (s1[0] - s0[0]) * w], (0 * LUT + k) * 4);
    data.set([n.x, n.y, n.z, s0[1] + (s1[1] - s0[1]) * w], (1 * LUT + k) * 4);
    data.set([t.x, t.y, t.z, 0], (2 * LUT + k) * 4);
    data.set([a.x, a.y, a.z, 0], (3 * LUT + k) * 4);
  }
  const lut = new THREE.DataTexture(data, LUT, 4, THREE.RGBAFormat, THREE.FloatType);
  lut.minFilter = lut.magFilter = THREE.NearestFilter;
  lut.needsUpdate = true;

  // one ribbon: SEGMENTS+1 rows of two vertices, head (aT = 0) to tail (aT = 1)
  const geometry = new THREE.InstancedBufferGeometry();
  const rows = SEGMENTS + 1;
  const aT = new Float32Array(rows * 2);
  const aSide = new Float32Array(rows * 2);
  const index: number[] = [];
  for (let r = 0; r < rows; r++) {
    aT[r * 2] = aT[r * 2 + 1] = r / SEGMENTS;
    aSide[r * 2] = -1;
    aSide[r * 2 + 1] = 1;
    if (r < SEGMENTS) {
      const a = r * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setIndex(index);
  // `position` is unused by the shader but three needs it to size draws
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rows * 2 * 3), 3));
  geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
  geometry.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));

  const count = Math.max(12, Math.min(90, Math.round(length * density)));
  const phase = new Float32Array(count);
  const offset = new Float32Array(count * 2);
  const meta = new Float32Array(count * 4);
  const speed = new Float32Array(count);
  // deterministic scatter so embeds and reloads look identical
  let seed = path.id.split("").reduce((acc, c) => acc * 31 + c.charCodeAt(0), 7) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // water streaks are short beads in a pipe; air streaks are long comets
  const water = binding.medium === "water";
  const trail = water ? Math.min(0.3, 0.12 / length) : Math.min(0.45, 0.42 / length);
  for (let k = 0; k < count; k++) {
    phase[k] = rnd() * (1 + trail);
    const r = Math.sqrt(rnd()) * 0.92;
    const th = rnd() * Math.PI * 2;
    offset[k * 2] = r * Math.cos(th);
    offset[k * 2 + 1] = r * Math.sin(th);
    speed[k] = 0.85 + rnd() * 0.3;
    meta.set([speed[k], (k + rnd()) / count, 0.85 + rnd() * 0.25, 0.7 + rnd() * 0.6], k * 4);
  }
  const phaseAttr = new THREE.InstancedBufferAttribute(phase, 1);
  phaseAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("iPhase", phaseAttr);
  geometry.setAttribute("iOffset", new THREE.InstancedBufferAttribute(offset, 2));
  geometry.setAttribute("iMeta", new THREE.InstancedBufferAttribute(meta, 4));
  geometry.instanceCount = count;

  return { id: path.id, binding, length, count, lut, geometry, phase: phaseAttr, speed, trail };
}

function StreamMesh({ s, reduced, dark }: { s: Stream; reduced: boolean; dark: boolean }) {
  const store = useRuntimeStore();
  const mesh = useRef<THREE.Mesh>(null);
  const rate = useRef<number | null>(null);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uLut: { value: s.lut },
          uLutW: { value: LUT },
          uTrail: { value: s.trail },
          uWidth: { value: s.binding.medium === "water" ? 0.009 : 0.016 },
          uRate: { value: 1 },
          uEdge: { value: Math.min(0.08, 0.2 / s.length) },
          // insulated pipe radius (≈4 cm) plus the stream's spread
          uLift: { value: s.binding.medium === "water" ? 0.055 : 0 },
          uColor: { value: new THREE.Color() },
          uOpacity: { value: 0.95 },
          uRim: { value: 0.62 },
        },
      }),
    [s],
  );

  useEffect(
    () => () => {
      material.dispose();
      s.geometry.dispose();
      s.lut.dispose();
    },
    [material, s],
  );

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const st = store.getState();
    m.visible = st.view.flow && !st.view.exploded;
    if (!m.visible) return;
    const o = st.outputs;
    const dt = Math.min(delta, 0.1);

    // smooth the flow share so density and speed ease instead of stepping at the sim tick
    const target = Math.min(1, Math.max(0, s.binding.rate(o)));
    rate.current = rate.current === null || reduced ? target : rate.current + (target - rate.current) * (1 - Math.exp(-dt / 0.35));
    const u = material.uniforms;
    u.uRate.value = rate.current;
    u.uRim.value = dark ? 0.62 : 0.34;
    const [r, g, b] = heatLinear(s.binding.tempF(o));
    (u.uColor.value as THREE.Color).setRGB(r, g, b, THREE.LinearSRGBColorSpace);

    if (reduced || !st.running) return;
    // integrate each particle's own position; a nearly closed path moves slower as well as thinner
    const velocity = 0.8 * (0.35 + 0.65 * rate.current); // m/s
    const wrap = 1 + s.trail * 1.3;
    const arr = s.phase.array as Float32Array;
    const step = (dt * velocity) / s.length;
    for (let k = 0; k < s.count; k++) {
      let ph = arr[k] + step * s.speed[k];
      if (ph > wrap) ph -= wrap;
      arr[k] = ph;
    }
    s.phase.needsUpdate = true;
  });

  return <mesh ref={mesh} geometry={s.geometry} material={material} frustumCulled={false} renderOrder={3} />;
}

export function FlowField({
  flows,
  reduced,
  dark,
  density,
  medium,
  withField,
}: {
  flows: Record<string, FlowPath>;
  reduced: boolean;
  dark: boolean;
  density: number;
  /** Only render streams of this medium (e.g. water, when a solved field handles the air) */
  medium?: "air" | "water";
  /** Only render the air streams marked `withField` (the ones a solved field doesn't replace) */
  withField?: boolean;
}) {
  const store = useRuntimeStore();
  const bindings = store.getState().mod.bindings.flows as Record<string, FlowBinding<Outputs>>;
  const streams = useMemo(
    () =>
      Object.entries(bindings).flatMap(([id, b]) =>
        flows[id] && (!medium || (b.medium ?? "air") === medium) && (!withField || b.withField)
          ? [buildStream(flows[id], b, b.medium === "water" ? density * 2.5 : density)]
          : [],
      ),
    [bindings, flows, density, medium, withField],
  );
  return (
    <>
      {streams.map((s) => (
        <StreamMesh key={s.id} s={s} reduced={reduced} dark={dark} />
      ))}
    </>
  );
}
