"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { heatLinear } from "../heat";
import { useRuntimeStore } from "../shell/runtime";
import type { FlowBinding, Outputs } from "../types";
import { INK_LAYER } from "./InkEdges";
import type { FlowPath } from "./sceneIndex";
import { DETAIL } from "./toon";

/**
 * Water as liquid: a solid core swept along each water path, inside its pipe, shaded like everything else
 * (flat bands from the key light, an inked outline) and colored by its temperature on the shared heat
 * scale. Its surface is a slow churn of ripples stretched along the pipe that rides downstream with the
 * water, plus thin bright dashes, sharp at their downstream end, that make the direction plain at a glance.
 * The pattern moves at a scaled-down water velocity and stills when the flow stops.
 *
 * The core hides inside opaque pipes, valves and fittings on its own; it shows where the pipes' jackets
 * turn see-through in the cutaway view (`Bindings.liquid.pipes`).
 */

const RADIAL = 18;
/** Ring spacing along the pipe, m */
const STEP = 0.012;
/** Drawn water speed at full flow, m/s: slow enough to follow by eye */
const SPEED = 0.5;

const vertexShader = /* glsl */ `
  attribute float aS;
  attribute float aA;
  varying float vS;
  varying float vA;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vS = aS;
    vA = aA;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uKeyDir;
  uniform float uOffset;
  uniform float uChurn;
  uniform float uFlow;
  uniform float uRadius;
  varying float vS;
  varying float vA;
  varying vec3 vN;
  varying vec3 vW;

  float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  vec2 hash22(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.xx + q.yz) * q.zy);
  }

  // caustic web: the borders between moving cells (F2 − F1 of a cellular noise), the look of light
  // through rippling water. Cells wrap around the pipe (AROUND of them), so there's no seam.
  const float AROUND = 5.0;
  float web(vec2 p, float t) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 c = i + g;
        c.y = mod(c.y, AROUND);
        vec2 h = hash22(c);
        vec2 o = 0.5 + 0.38 * sin(t + 6.2831 * h);
        float d = length(g + o - f);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
    return f2 - f1;
  }

  // one lane of dashes: cells of length cell along the pipe, each with a dash at a random angle,
  // sharp at its downstream end and thinning back toward its tail
  float dashes(float along, float a, float circ, float cell, float seed) {
    float x = along / cell;
    float ci = floor(x) + seed;
    float fx = fract(x);
    float r1 = hash11(ci * 1.7 + 0.3);
    float r2 = hash11(ci * 3.1 + 9.2);
    float r3 = hash11(ci * 5.3 + 1.1);
    float head = 0.35 + 0.5 * r1;
    float len = 0.45 + 0.2 * r3;
    float d = head - fx;
    float body = step(0.0, d) * (1.0 - smoothstep(len * 0.5, len, d));
    float taper = 1.0 - clamp(d / len, 0.0, 1.0) * 0.8;
    float ang = abs(fract(a - r2 + 0.5) - 0.5) * circ;
    float hw = 0.06 * circ * taper;
    float aw = fwidth(ang) + 1e-5;
    return body * (1.0 - smoothstep(hw - aw, hw + aw, ang)) * step(r3, 0.7);
  }

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float facing = clamp(dot(N, V), 0.0, 1.0);
    float circ = 6.2831853 * uRadius;
    // the surface pattern rides downstream with the water
    float along = vS - uOffset;

    // two flat bands from the key light, like the rest of the scene
    float lit = dot(N, uKeyDir) * 0.5 + 0.5;
    float lw = fwidth(lit) + 1e-4;
    vec3 deep = uColor * 0.62;
    vec3 col = mix(deep, uColor, smoothstep(0.42 - lw, 0.42 + lw, lit));

    // caustic web, cells stretched along the pipe: a cell is a couple of pipe-widths long
    vec2 p = vec2(along / (uRadius * 4.6), vA * AROUND);
    float e = web(p, uChurn);
    float ew = fwidth(e) * 1.2 + 1e-4;
    float line = 1.0 - smoothstep(0.055 - ew, 0.055 + ew, e);
    vec3 hi = mix(uColor, vec3(1.0), 0.55);
    // still water is calm: the web is faint until the water moves
    col = mix(col, hi, line * mix(0.55, 0.9, lit) * mix(0.2, 1.0, uFlow));

    // the column's edges a touch darker, so it reads round
    col *= mix(0.78, 1.0, smoothstep(0.05, 0.45, facing));

    // dashes riding the flow: white on deep water, a dark stroke of its own color on pale water
    float g = max(dashes(along, vA, circ, 0.16, 0.0), dashes(along + 0.07, vA + 0.5, circ, 0.19, 41.0));
    float lum = dot(uColor, vec3(0.2126, 0.7152, 0.0722));
    vec3 dashCol = mix(vec3(1.0), uColor * 0.28, smoothstep(0.4, 0.65, lum));
    col = mix(col, dashCol, g * uFlow * 0.95);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

interface Tube {
  id: string;
  binding: FlowBinding<Outputs>;
  geometry: THREE.BufferGeometry;
  radius: number;
}

function buildTube(path: FlowPath, binding: FlowBinding<Outputs>): Tube {
  const radius = binding.radius ?? 0.015;
  const curve = new THREE.CatmullRomCurve3(path.points, false, "centripetal", 0.5);
  const length = curve.getLength();
  const segs = Math.max(8, Math.ceil(length / STEP));
  const frames = curve.computeFrenetFrames(segs, false);
  const rows = segs + 1;
  const cols = RADIAL + 1;
  const pos = new Float32Array(rows * cols * 3);
  const nor = new Float32Array(rows * cols * 3);
  const aS = new Float32Array(rows * cols);
  const aA = new Float32Array(rows * cols);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    const u = i / segs;
    curve.getPointAt(u, p);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j < cols; j++) {
      const a = j / RADIAL;
      const th = a * Math.PI * 2;
      n.copy(N).multiplyScalar(Math.cos(th)).addScaledVector(B, Math.sin(th));
      const k = i * cols + j;
      pos.set([p.x + n.x * radius, p.y + n.y * radius, p.z + n.z * radius], k * 3);
      nor.set([n.x, n.y, n.z], k * 3);
      aS[k] = u * length;
      aA[k] = a;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const a = i * cols + j;
      const b = a + cols;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute("aS", new THREE.BufferAttribute(aS, 1));
  geometry.setAttribute("aA", new THREE.BufferAttribute(aA, 1));
  geometry.computeBoundingSphere();
  return { id: path.id, binding, geometry, radius };
}

function LiquidTube({ t, reduced }: { t: Tube; reduced: boolean }) {
  const store = useRuntimeStore();
  const mesh = useRef<THREE.Mesh>(null);
  const rate = useRef<number | null>(null);
  const clock = useRef({ offset: 0, churn: Math.random() * 10 });

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color() },
          uKeyDir: DETAIL.uKeyDir,
          uOffset: { value: 0 },
          uChurn: { value: 0 },
          uFlow: { value: 0 },
          uRadius: { value: t.radius },
        },
      }),
    [t],
  );

  useEffect(() => {
    // outlined by the ink pass like any other surface
    mesh.current?.layers.enable(INK_LAYER);
    return () => {
      material.dispose();
      t.geometry.dispose();
    };
  }, [material, t]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const st = store.getState();
    const o = st.outputs;
    m.visible = st.view.flow && !st.view.exploded && (t.binding.visible?.(o) ?? true);
    if (!m.visible) return;
    const dt = Math.min(delta, 0.1);
    const target = Math.min(1, Math.max(0, t.binding.rate(o)));
    rate.current = rate.current === null || reduced ? target : rate.current + (target - rate.current) * (1 - Math.exp(-dt / 0.35));
    const u = material.uniforms;
    const [r, g, b] = heatLinear(t.binding.tempF(o));
    (u.uColor.value as THREE.Color).setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    // the dashes only mean something while the water moves
    u.uFlow.value = THREE.MathUtils.smoothstep(rate.current, 0.02, 0.12);
    if (reduced || !st.running) return;
    clock.current.offset += dt * SPEED * rate.current;
    // standing water still shimmers a little; moving water churns more
    clock.current.churn += dt * (0.25 + 0.9 * rate.current);
    u.uOffset.value = clock.current.offset;
    u.uChurn.value = clock.current.churn;
  });

  return <mesh ref={mesh} geometry={t.geometry} material={material} />;
}

export function LiquidFlow({ flows, reduced }: { flows: Record<string, FlowPath>; reduced: boolean }) {
  const store = useRuntimeStore();
  const bindings = store.getState().mod.bindings.flows as Record<string, FlowBinding<Outputs>>;
  const tubes = useMemo(
    () => Object.entries(bindings).flatMap(([id, b]) => (flows[id] && b.medium === "water" ? [buildTube(flows[id], b)] : [])),
    [bindings, flows],
  );
  return (
    <>
      {tubes.map((t) => (
        <LiquidTube key={t.id} t={t} reduced={reduced} />
      ))}
    </>
  );
}
