"use client";

import { createContext, useContext, useEffect } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { AnyLabModule, Outputs, TrendControl } from "../types";

export interface ViewState {
  cutaway: boolean;
  exploded: boolean;
  flow: boolean;
  labels: boolean;
}

export interface TrendBuffer {
  t: number[];
  series: Record<string, number[]>;
}

export interface RuntimeState {
  mod: AnyLabModule;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputs: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any;
  outputs: Outputs;
  running: boolean;
  speed: 1 | 4 | 16;
  view: ViewState;
  presetId: string | null;
  /** Inputs changed since the preset was applied */
  dirty: boolean;
  cue: { text: string; at: number } | null;
  trend: TrendBuffer;
  /** Bumped whenever the scene should animate a transition (view change, preset) */
  transitionAt: number;
  /** Bumped to fly the camera home */
  cameraNonce: number;
  lastSample: number;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setInputs: (fn: (i: any) => any) => void;
  applyPreset: (id: string) => void;
  reset: () => void;
  togglePlay: () => void;
  setSpeed: (s: 1 | 4 | 16) => void;
  setView: (v: Partial<ViewState>) => void;
  toggleView: (k: keyof ViewState) => void;
  dismissCue: () => void;
  resetCamera: () => void;
  /** Advance by real seconds (scaled by speed, sub-stepped) */
  advance: (realDt: number) => void;
}

export type RuntimeStore = StoreApi<RuntimeState>;

const SUBSTEP = 0.05;

function trendPens(mod: AnyLabModule) {
  return mod.controls.flatMap((s) => s.controls.filter((c): c is TrendControl<Outputs> => c.kind === "trend"));
}

function emptyTrend(mod: AnyLabModule): TrendBuffer {
  const series: Record<string, number[]> = {};
  for (const tc of trendPens(mod)) for (const p of tc.pens) series[p.id] = [];
  return { t: [], series };
}

export function createRuntime(
  mod: AnyLabModule,
  opts: { preset?: string; view?: Partial<ViewState> } = {},
): RuntimeStore {
  const presetId = opts.preset && mod.presets.some((p) => p.id === opts.preset) ? opts.preset : mod.defaultPreset;
  const preset = mod.presets.find((p) => p.id === presetId)!;
  const inputs = structuredClone(preset.inputs);
  const state = mod.model.init(inputs, preset.seed);
  const windowSec = Math.max(0, ...trendPens(mod).map((t) => t.window));
  const period = mod.samplePeriod ?? 0.25;

  return createStore<RuntimeState>((set, get) => ({
    mod,
    inputs,
    state,
    outputs: mod.model.outputs(state, inputs),
    running: true,
    speed: 1,
    view: { cutaway: true, exploded: false, flow: true, labels: true, ...opts.view },
    presetId,
    dirty: false,
    cue: { text: preset.cue, at: Date.now() },
    trend: emptyTrend(mod),
    transitionAt: 0,
    cameraNonce: 0,
    lastSample: -Infinity,

    setInputs: (fn) => {
      const inputs = fn(get().inputs);
      set({ inputs, outputs: mod.model.outputs(get().state, inputs), dirty: true });
    },

    applyPreset: (id) => {
      const p = mod.presets.find((x) => x.id === id);
      if (!p) return;
      const inputs = structuredClone(p.inputs);
      const state = mod.model.init(inputs, p.seed);
      set({
        inputs,
        state,
        outputs: mod.model.outputs(state, inputs),
        presetId: id,
        dirty: false,
        cue: { text: p.cue, at: Date.now() },
        trend: emptyTrend(mod),
        lastSample: -Infinity,
        running: true,
        transitionAt: performance.now(),
      });
    },

    reset: () => {
      get().applyPreset(get().presetId ?? mod.defaultPreset);
      set({ view: { cutaway: true, exploded: false, flow: true, labels: true, ...opts.view }, speed: 1, cameraNonce: get().cameraNonce + 1 });
    },

    togglePlay: () => set({ running: !get().running }),
    setSpeed: (speed) => set({ speed }),
    setView: (v) => set({ view: { ...get().view, ...v }, transitionAt: performance.now() }),
    toggleView: (k) => set({ view: { ...get().view, [k]: !get().view[k] }, transitionAt: performance.now() }),
    dismissCue: () => set({ cue: null }),
    resetCamera: () => set({ cameraNonce: get().cameraNonce + 1, transitionAt: performance.now() }),

    advance: (realDt) => {
      const st = get();
      if (!st.running) return;
      let remaining = Math.min(realDt, 0.25) * st.speed;
      let state = st.state;
      while (remaining > 1e-6) {
        const dt = Math.min(SUBSTEP, remaining);
        state = mod.model.step(state, st.inputs, dt);
        remaining -= dt;
      }
      const outputs = mod.model.outputs(state, st.inputs);
      const patch: Partial<RuntimeState> = { state, outputs };

      const t = state.t as number;
      if (t - st.lastSample >= period) {
        const trend: TrendBuffer = { t: [...st.trend.t, t], series: {} };
        for (const tc of trendPens(mod)) {
          for (const pen of tc.pens) trend.series[pen.id] = [...(st.trend.series[pen.id] ?? []), pen.value(outputs)];
        }
        // drop samples that scrolled out of the widest window
        let drop = 0;
        while (drop < trend.t.length && trend.t[drop] < t - windowSec - period) drop++;
        if (drop) {
          trend.t = trend.t.slice(drop);
          for (const k in trend.series) trend.series[k] = trend.series[k].slice(drop);
        }
        patch.trend = trend;
        patch.lastSample = t;
      }
      set(patch);
    },
  }));
}

// ── React plumbing ──────────────────────────────────────────────────────────

export const RuntimeContext = createContext<RuntimeStore | null>(null);

export function useRuntimeStore(): RuntimeStore {
  const store = useContext(RuntimeContext);
  if (!store) throw new Error("useRuntime must be used inside a lab module");
  return store;
}

export function useRuntime<T>(selector: (s: RuntimeState) => T): T {
  return useStore(useRuntimeStore(), selector);
}

/** Drives the simulation on a timer, independent of rendering. Pauses when the tab is hidden. */
export function useSimLoop(store: RuntimeStore) {
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (document.hidden) return;
      store.getState().advance(dt);
    }, 50);
    return () => window.clearInterval(id);
  }, [store]);
}
