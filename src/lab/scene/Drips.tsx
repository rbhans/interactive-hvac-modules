"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useRuntimeStore } from "../shell/runtime";
import type { Condensate, Outputs } from "../types";

const MAX = 70;
const G = 3.2; // m/s², slowed from 9.8 so drops read at this scale

/** Condensate: drops form along a coil's drip edge and fall into the pan, more of them the harder it condenses. */
export function Drips({ binding, from, to, reduced }: { binding: Condensate<Outputs>; from: [THREE.Vector3, THREE.Vector3]; to: THREE.Vector3; reduced: boolean }) {
  const store = useRuntimeStore();
  const ref = useRef<THREE.InstancedMesh>(null);
  const drops = useMemo(
    () =>
      Array.from({ length: MAX }, (_, k) => ({
        t: Math.random(), // along the drip edge
        y: 0, // fallen distance
        v: 0,
        wait: Math.random() * 1.5, // time until it lets go
        gate: (k + Math.random()) / MAX, // visible when rate > gate
      })),
    [],
  );
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 8, 6), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: "#a9dcff", transparent: true, opacity: 0.9, toneMapped: false }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }), []);
  const fall = from[0].y - to.y;

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const st = store.getState();
    const rate = Math.min(1, Math.max(0, binding.rate(st.outputs)));
    mesh.visible = st.view.flow && !st.view.exploded && rate > 0.02;
    if (!mesh.visible) return;
    const dt = st.running && !reduced ? Math.min(delta, 0.05) : 0;
    drops.forEach((d, k) => {
      const on = d.gate < rate;
      if (d.wait > 0) {
        d.wait -= dt;
        d.y = 0;
        d.v = 0;
      } else {
        d.v += G * dt;
        d.y += d.v * dt;
        if (d.y >= fall) {
          d.t = Math.random();
          d.wait = 0.3 + Math.random() * (1.8 - rate);
          d.y = 0;
          d.v = 0;
        }
      }
      // a drop swells while it hangs, then stretches as it falls
      const hang = d.wait > 0 ? Math.max(0.35, 1 - d.wait) : 1;
      const r = on ? 0.0065 * hang : 0;
      tmp.p.lerpVectors(from[0], from[1], d.t);
      tmp.p.y -= d.y;
      tmp.s.set(r, r * (1 + Math.min(2, d.v * 0.6)), r);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      mesh.setMatrixAt(k, tmp.m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geometry, material, MAX]} frustumCulled={false} renderOrder={4} />;
}
