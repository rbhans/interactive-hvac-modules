"use client";

import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useRuntime, useRuntimeStore, RuntimeContext, type RuntimeState } from "../shell/runtime";
import type { AnyLabModule, Bindings, Outputs } from "../types";
import { Callouts } from "./Callouts";
import { AirFlow } from "./AirFlow";
import { Drips } from "./Drips";
import { Equipment } from "./Equipment";
import { FlowField } from "./FlowField";
import { InkEdges } from "./InkEdges";
import { RideCamera } from "./RideCamera";
import type { SceneIndex } from "./sceneIndex";


/** A missing or invalid GLB shouldn't take the controls down with it. */
class AssetBoundary extends Component<{ children: ReactNode; onError: (e: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: Error) {
    this.props.onError(e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Frame loop on demand: continuous frames only while the module is on screen,
 * the tab is visible and the sim is running (or a view transition is playing).
 * With reduced motion, frames are rendered only when the quantized state changes,
 * and each change is crossfaded from a snapshot of the previous frame.
 */
const q = (x: number, per: number) => (Number.isFinite(x) ? Math.round(x * per) : null);

/**
 * Everything the 3D view draws, quantized: part drives, air and water streams and their temperatures,
 * tints, highlights, drips and the view. With reduced motion a new frame is rendered only when this changes.
 */
function sceneKey(mod: AnyLabModule, o: Outputs, view: object) {
  const b = mod.bindings as Bindings<unknown, Outputs>;
  const temp = (t: number) => q(t, 0.5); // 2 °F
  const frac = (x: number) => q(x, 12);
  return JSON.stringify([
    view,
    Object.entries(o).map(([k, x]) => (/Pos$|Flow$|Speed$/.test(k) ? frac(x) : 0)),
    Object.values(b.drives ?? {}).map((d) => frac(d!(o))),
    Object.values(b.flows).map((f) => [frac(f.rate(o)), temp(f.tempF(o))]),
    b.field && [
      frac(b.field.position(o)),
      Object.values(b.field.emit).map((e) => frac(e(o))),
      Object.values(b.field.tempF).map((t) => temp(t(o))),
      Object.values(b.field.stages).map((t) => temp(t(o))),
    ],
    (b.tints ?? []).map((t) => [temp(t.tempF(o)), typeof t.amount === "function" ? frac(t.amount(o)) : 0, t.when ? t.when(o) : true]),
    (b.highlights ?? []).map((h) => h.when(o)),
    b.condensate && frac(b.condensate.rate(o)),
  ]);
}

function FrameDriver({ active, reduced, onSnapshot }: { active: boolean; reduced: boolean; onSnapshot: (url: string) => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const getThree = useThree((s) => s.get);
  const store = useRuntimeStore();
  // the scene state last rendered with reduced motion; kept across effect runs so changes made off screen still land
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __three?: unknown }).__three = getThree;
  }, [getThree]);

  useEffect(() => {
    if (!active || reduced) return;
    let raf = 0;
    const loop = () => {
      const s = store.getState();
      if (s.running || performance.now() - s.transitionAt < 1600) invalidate();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, reduced, store, invalidate]);

  useEffect(() => {
    if (!reduced) {
      // paused edits still need a frame
      return store.subscribe((s, p) => {
        if (s.inputs !== p.inputs || s.view !== p.view || s.presetId !== p.presetId) invalidate();
      });
    }
    const key = (s: RuntimeState) => sceneKey(s.mod, s.outputs, s.view);
    shown.current ??= key(store.getState());
    let lastAt = 0;
    let pending: number | undefined;
    const commit = () => {
      pending = undefined;
      const k = key(store.getState());
      if (k === shown.current) return;
      shown.current = k;
      lastAt = performance.now();
      try {
        onSnapshot(gl.domElement.toDataURL("image/webp", 0.85));
      } catch {
        /* snapshot is decorative */
      }
      invalidate();
    };
    const schedule = () => {
      // at most one crossfade per 700 ms, always ending on the latest state
      if (pending === undefined) pending = window.setTimeout(commit, Math.max(0, 700 - (performance.now() - lastAt)));
    };
    // back on screen after changes made while away: catch up
    if (active && key(store.getState()) !== shown.current) schedule();
    const unsub = store.subscribe((s) => {
      if (active && key(s) !== shown.current) schedule();
    });
    return () => {
      unsub();
      window.clearTimeout(pending);
    };
  }, [reduced, active, store, gl, invalidate, onSnapshot]);

  return null;
}

function CondensateFor({ idx, reduced }: { idx: SceneIndex; reduced: boolean }) {
  const store = useRuntimeStore();
  const binding = store.getState().mod.bindings.condensate!;
  const pts = useMemo(() => {
    const get = (n: string) => idx.byName.get(n)?.getWorldPosition(new THREE.Vector3());
    const a = get(binding.from[0]);
    const b = get(binding.from[1]);
    const pan = get(binding.to);
    return a && b && pan ? { from: [a, b] as [THREE.Vector3, THREE.Vector3], to: pan } : null;
  }, [idx, binding]);
  if (!pts) return null;
  return <Drips binding={binding} from={pts.from} to={pts.to} reduced={reduced} />;
}

/** Authored camera poses assume a ~1.9:1 display; narrower displays back the camera off to keep the unit in frame. */
const REF_ASPECT = 1.9;

function Rig({ position, target }: { position: [number, number, number]; target: [number, number, number] }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const fit = Math.min(1.75, Math.max(1, REF_ASPECT / aspect));
  const nonce = useRuntime((s) => s.cameraNonce);
  const riding = useRuntime((s) => s.ride !== null);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  // Wheel zoom only after the user engages the canvas, so the page still scrolls past it.
  // On touch, one finger scrolls the page and two fingers orbit/zoom.
  const [engaged, setEngaged] = useState(false);
  const [coarse] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    const el = gl.domElement;
    const on = () => setEngaged(true);
    const off = () => setEngaged(false);
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerleave", off);
    return () => {
      el.removeEventListener("pointerdown", on);
      el.removeEventListener("pointerleave", off);
    };
  }, [gl]);
  useEffect(() => {
    if (coarse) gl.domElement.style.touchAction = "pan-y";
  });

  useEffect(() => {
    const c = controls.current;
    // the ride has the camera; when it ends it bumps the nonce and this flies home from wherever it was
    if (!c || riding) return;
    const from = camera.position.clone();
    const fromT = c.target.clone();
    const toT = new THREE.Vector3(...target);
    const to = new THREE.Vector3(...position).sub(toT).multiplyScalar(fit).add(toT);
    if (nonce === 0) {
      camera.position.copy(to);
      c.target.copy(toT);
      c.update();
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - start) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(from, to, e);
      c.target.lerpVectors(fromT, toT, e);
      c.update();
      invalidate();
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nonce, camera, position, target, invalidate, fit, riding]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={target}
      enableDamping
      dampingFactor={0.12}
      enableZoom={engaged || coarse}
      touches={coarse ? { ONE: undefined as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE } : undefined}
      minDistance={3}
      maxDistance={15}
      minPolarAngle={0.15}
      maxPolarAngle={Math.PI * 0.495}
      panSpeed={0.6}
      screenSpacePanning
    />
  );
}

function Shadows({ dark }: { dark: boolean }) {
  // re-rendering resets drei's frame counter, so each view change re-bakes the shadow for a moment
  useRuntime((s) => s.transitionAt);
  return (
    <ContactShadows
      position={[0.1, 0.004, 0]}
      opacity={dark ? 0.7 : 0.45}
      scale={9}
      blur={2.4}
      far={2.4}
      resolution={512}
      color={dark ? "#000000" : "#2a2b30"}
      frames={90}
    />
  );
}

export default function LabCanvas({
  active,
  reduced,
  compact,
  onSnapshot,
  onReady,
  onError,
  dark,
}: {
  active: boolean;
  reduced: boolean;
  dark: boolean;
  compact?: boolean;
  onSnapshot: (url: string) => void;
  onReady?: () => void;
  onError?: (e: Error) => void;
}) {
  const store = useRuntimeStore();
  const mod = store.getState().mod;
  const [idx, setIdx] = useState<SceneIndex | null>(null);
  const handleReady = useCallback(
    (i: SceneIndex) => {
      setIdx(i);
      onReady?.();
      // dev-only handle for poking at the scene from the console
      if (process.env.NODE_ENV !== "production") (window as unknown as { __lab?: unknown }).__lab = { idx: i, store };
    },
    [onReady, store],
  );

  return (
    <Canvas
      frameloop="demand"
      // the key light's cast shadows are where the hand-drawn hatching goes
      shadows="percentage"
      dpr={[1, compact ? 1.5 : 2]}
      camera={{ position: mod.camera.position, fov: mod.camera.fov ?? 35, near: 0.1, far: 60 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: reduced, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      aria-hidden
    >
      {/* R3F renders in its own reconciler; re-provide the store */}
      <RuntimeContext.Provider value={store}>
        {/* transparent canvas: the stage gradient behind it is CSS, so it follows the page theme */}
        <hemisphereLight args={["#f4f6fb", dark ? "#23252b" : "#8d9097", dark ? 0.6 : 0.75]} />
        <directionalLight
          position={[-4, 7, 6]}
          intensity={2.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.025}
          shadow-camera-left={-4.5}
          shadow-camera-right={4.5}
          shadow-camera-top={4.5}
          shadow-camera-bottom={-4.5}
          shadow-camera-near={1}
          shadow-camera-far={22}
        />
        <directionalLight position={[6, 3, -5]} intensity={0.9} color="#cdd6ff" />
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={2.2} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[10, 4, 1]} />
          <Lightformer form="rect" intensity={1.1} position={[-6, 2, 3]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
          <Lightformer form="rect" intensity={0.8} color="#ffd6b8" position={[6, 2, 4]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} />
        </Environment>

        <AssetBoundary onError={(e) => onError?.(e)}>
        <Suspense fallback={null}>
          <Equipment url={mod.glb} reduced={reduced} onReady={handleReady} />
          {/* after Equipment, so its frame callback sees this frame's part positions */}
          {idx && <InkEdges />}
          {idx &&
            (mod.bindings.field ? (
              <>
                <AirFlow
                  binding={mod.bindings.field}
                  reduced={reduced}
                  dark={dark}
                  compact={compact}
                  fallback={<FlowField flows={idx.flows} reduced={reduced} dark={dark} density={compact ? 11 : 16} medium="air" />}
                />
                <FlowField flows={idx.flows} reduced={reduced} dark={dark} density={compact ? 11 : 16} medium="water" />
              </>
            ) : (
              <FlowField flows={idx.flows} reduced={reduced} dark={dark} density={compact ? 11 : 16} />
            ))}
          {idx && mod.bindings.condensate && <CondensateFor idx={idx} reduced={reduced} />}
          {idx && <Callouts anchors={idx.anchors} callouts={mod.bindings.callouts ?? []} />}
          <Shadows dark={dark} />
        </Suspense>
        </AssetBoundary>

        <Rig position={mod.camera.position} target={mod.camera.target} />
        {mod.bindings.ride && mod.bindings.field && <RideCamera active={active} />}
        <FrameDriver active={active} reduced={reduced} onSnapshot={onSnapshot} />
      </RuntimeContext.Provider>
    </Canvas>
  );
}
