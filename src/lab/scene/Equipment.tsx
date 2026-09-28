"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { heatLinear } from "../heat";
import { useRuntimeStore } from "../shell/runtime";
import { indexScene, type HighlightMesh, type SceneIndex } from "./sceneIndex";
import { addInkHulls, toonify } from "./toon";

const X = new THREE.Vector3(1, 0, 0);
const FAULT = new THREE.Color("#f0a000");
const HAND = new THREE.Color("#2c5bff");
const DEG = Math.PI / 180;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Loads the module GLB and drives it from model outputs every frame:
 * ranged rotation/translation, continuous spin, stretch-linked rods,
 * exploded offsets, cutaway ghosting and fault/override tinting.
 */
export function Equipment({ url, reduced, onReady }: { url: string; reduced: boolean; onReady: (idx: SceneIndex) => void }) {
  const store = useRuntimeStore();
  const mod = store.getState().mod;
  const gltf = useGLTF(url, false, true);

  const { idx, ink } = useMemo(() => {
    const scene = gltf.scene.clone(true);
    toonify(scene);
    const prefixes = [...(mod.bindings.highlights ?? []).flatMap((h) => h.parts), ...(mod.bindings.tints ?? []).flatMap((t) => t.parts)];
    const idx = indexScene(scene, prefixes);
    // cutaway panels get their own outline material so it can fade with the ghost
    const ink = addInkHulls(scene, { ownHull: new Set(idx.ghosts.map((g) => g.mesh)) });
    return { idx, ink };
  }, [gltf, mod]);

  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    onReady(idx);
    invalidate();
  }, [idx, onReady, invalidate]);

  // resolve highlight rules to mesh lists once
  const rules = useMemo(
    () =>
      (mod.bindings.highlights ?? []).map((h) => {
        const meshes = new Set<HighlightMesh>();
        for (const [name, list] of idx.highlightable) {
          if (h.parts.some((p) => name === p || name.startsWith(p))) list.forEach((m) => meshes.add(m));
        }
        return { when: h.when, meshes: [...meshes] };
      }),
    [idx, mod],
  );
  const allHighlight = useMemo(() => [...new Set(rules.flatMap((r) => r.meshes))], [rules]);
  const tints = useMemo(
    () =>
      (mod.bindings.tints ?? []).map((t) => {
        const meshes = new Set<HighlightMesh>();
        for (const [name, list] of idx.highlightable) {
          if (t.parts.some((p) => name === p || name.startsWith(p))) list.forEach((m) => meshes.add(m));
        }
        return { rule: t, meshes: [...meshes] };
      }),
    [idx, mod],
  );

  const authored = useMemo(() => new Map(idx.parts.map((p) => [p.name, p.range] as const)), [idx]);
  const lookup = useMemo(() => (n: string) => authored.get(n), [authored]);

  const view = useRef({ ghost: store.getState().view.cutaway ? 1 : 0, explode: store.getState().view.exploded ? 1 : 0, first: true });
  const tmp = useMemo(
    () => ({
      q: new THREE.Quaternion(),
      v: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      d: new THREE.Vector3(),
      m: new THREE.Matrix4(),
      px: new THREE.Vector2(),
    }),
    [],
  );

  useFrame((state, delta) => {
    const s = store.getState();
    const o = s.outputs;
    const dt = Math.min(delta, 0.1);
    const snap = reduced || view.current.first;
    view.current.first = false;
    const kPart = snap ? 1 : 1 - Math.exp(-dt / 0.06);
    const kView = snap ? 1 : 1 - Math.exp(-dt / 0.16);

    // ── view transitions ──────────────────────────────────────────────────
    view.current.ghost += ((s.view.cutaway ? 1 : 0) - view.current.ghost) * kView;
    view.current.explode += ((s.view.exploded ? 1 : 0) - view.current.explode) * kView;
    const e = ease(Math.min(1, Math.max(0, view.current.explode)));
    for (const n of idx.explode) n.obj.position.copy(n.basePos).addScaledVector(n.offset, e);

    // ── parts ─────────────────────────────────────────────────────────────
    for (const p of idx.parts) {
      if (p.motion === "link") continue;
      const drive = p.drives ? (mod.bindings.drives?.[p.drives]?.(o) ?? o[p.drives] ?? 0) : 0;
      p.value += (Math.min(1, Math.max(0, drive)) - p.value) * kPart;
      const [lo, hi] = mod.bindings.range ? mod.bindings.range(p.name, p.range, s.inputs, lookup) : p.range;

      if (p.motion === "rotate") {
        tmp.q.setFromAxisAngle(X, (lo + (hi - lo) * p.value) * DEG);
        p.obj.quaternion.copy(p.baseQuat).multiply(tmp.q);
      } else if (p.motion === "spin") {
        if (!reduced && s.running) p.spin = (p.spin + dt * hi * DEG * p.value) % (Math.PI * 2);
        tmp.q.setFromAxisAngle(X, p.spin);
        p.obj.quaternion.copy(p.baseQuat).multiply(tmp.q);
      } else if (p.motion === "translate") {
        const exploded = idx.explode.find((n) => n.obj === p.obj);
        const base = exploded ? exploded.obj.position.clone() : p.basePos;
        tmp.v.copy(X).applyQuaternion(p.baseQuat);
        p.obj.position.copy(base).addScaledVector(tmp.v, lo + (hi - lo) * p.value);
      }
    }

    // ── link rods follow their pins ───────────────────────────────────────
    idx.root.updateMatrixWorld(true);
    for (const p of idx.parts) {
      if (p.motion !== "link" || !p.from || !p.to || !p.obj.parent) continue;
      tmp.m.copy(p.obj.parent.matrixWorld).invert();
      p.from.getWorldPosition(tmp.a).applyMatrix4(tmp.m);
      p.to.getWorldPosition(tmp.b).applyMatrix4(tmp.m);
      tmp.d.subVectors(tmp.b, tmp.a);
      const len = tmp.d.length();
      if (len < 1e-6) continue;
      tmp.d.divideScalar(len);
      tmp.v.copy(X).applyQuaternion(p.baseQuat); // authored direction
      tmp.q.setFromUnitVectors(tmp.v, tmp.d);
      p.obj.position.copy(tmp.a);
      p.obj.quaternion.copy(tmp.q).multiply(p.baseQuat);
      p.obj.scale.set(p.baseScale.x * (len / (p.restLength ?? len)), p.baseScale.y, p.baseScale.z);
    }

    // ── ink outlines: constant width in CSS pixels ──────────────────────────
    state.gl.getDrawingBufferSize(tmp.px);
    for (const mat of ink.materials) {
      mat.uniforms.size.value.copy(tmp.px);
      mat.uniforms.thickness.value = ink.lineWidth * state.viewport.dpr;
    }

    // ── cutaway ghosting ──────────────────────────────────────────────────
    const g = view.current.ghost;
    for (const gm of idx.ghosts) {
      const transparent = g > 0.01;
      if (gm.material.transparent !== transparent) {
        gm.material.transparent = transparent;
        gm.material.needsUpdate = true;
      }
      gm.material.opacity = 1 - 0.93 * g;
      gm.material.depthWrite = g < 0.5;
      (gm.edges.material as THREE.LineBasicMaterial).opacity = 0.55 * g;
      gm.edges.visible = g > 0.01;
      const hull = ink.own.get(gm.mesh);
      if (hull) {
        (hull.material as THREE.ShaderMaterial).uniforms.opacity.value = 1 - g;
        hull.visible = g < 0.97;
      }
    }

    // ── temperature tints (pipes, coil fins) ──────────────────────────────
    for (const { rule, meshes } of tints) {
      const on = rule.when ? rule.when(o) : true;
      const [r, g, b] = heatLinear(rule.tempF(o));
      const k = on ? (rule.amount ?? 0.8) : 0;
      for (const h of meshes) {
        h.material.color.setRGB(
          h.baseColor.r + (r - h.baseColor.r) * k,
          h.baseColor.g + (g - h.baseColor.g) * k,
          h.baseColor.b + (b - h.baseColor.b) * k,
          THREE.LinearSRGBColorSpace,
        );
      }
    }

    // ── fault / override tinting ──────────────────────────────────────────
    for (const h of allHighlight) {
      h.material.emissive.copy(h.baseEmissive);
      h.material.emissiveIntensity = h.baseIntensity;
    }
    const pulse = reduced ? 0.7 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * Math.PI * 2 * 1.1));
    for (const r of rules) {
      const st = r.when(o);
      if (!st) continue;
      for (const h of r.meshes) {
        h.material.emissive.copy(st === "fault" ? FAULT : HAND);
        h.material.emissiveIntensity = st === "fault" ? 0.08 + 0.42 * pulse : 0.45;
      }
    }
  });

  return <primitive object={idx.root} />;
}

export function preloadGLB(url: string) {
  useGLTF.preload(url, false, true);
}
