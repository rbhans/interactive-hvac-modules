"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { HandIcon, Led } from "../controls/primitives";
import { heatCss, heatGradient } from "../heat";
import type { PointStatus } from "../types";
import { useDarkScheme, useInView, usePageVisible, useReducedMotion } from "./hooks";
import { useRuntime, type ViewState } from "./runtime";

const LabCanvas = dynamic(() => import("../scene/LabCanvas"), { ssr: false });

const LEGEND_LO = 0;
const LEGEND_HI = 100;

function StatusChips() {
  // serialize so the selector result is stable between identical ticks
  const json = useRuntime((s) => JSON.stringify(s.mod.bindings.status?.(s.outputs) ?? []));
  const chips = useMemo(() => JSON.parse(json) as { label: string; state: PointStatus | "off" }[], [json]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.label}
          className={cn(
            "num flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[10px] uppercase tracking-[0.08em]",
            c.state === "fault"
              ? "bg-fault text-black"
              : c.state === "overridden"
                ? "bg-hand text-white"
                : "bg-[var(--stage-chip)] text-stage-ink shadow-[inset_0_0_0_1px_var(--stage-chip-edge)] backdrop-blur-md",
          )}
        >
          {c.state === "overridden" ? <HandIcon className="size-3" /> : c.state === "fault" ? <span className="led !bg-black/70 !shadow-none" /> : <Led state={c.state} className={c.state === "off" ? "!bg-stage-dim" : ""} />}
          {c.label}
        </span>
      ))}
    </div>
  );
}

function Transport() {
  const { t, running, speed, togglePlay, setSpeed } = useRuntime(
    useShallow((s) => ({ t: Math.floor(s.state.t as number), running: s.running, speed: s.speed, togglePlay: s.togglePlay, setSpeed: s.setSpeed })),
  );
  const mm = String(Math.floor(t / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="num mr-1 hidden text-[11px] tabular-nums text-stage-dim sm:inline"
        aria-label={`Simulation time ${mm} minutes ${ss} seconds`}
        title="Simulated time. At 1× it already runs about 7× faster than a real unit (a 90 s actuator strokes in 12 s)."
      >
        T+{mm}:{ss}
      </span>
      <button type="button" className="key-screen !px-2" onClick={togglePlay} aria-label={running ? "Pause simulation" : "Run simulation"} title="Space">
        {running ? (
          <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
            <rect x="1.5" y="1" width="2.5" height="8" rx=".5" fill="currentColor" />
            <rect x="6" y="1" width="2.5" height="8" rx=".5" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
            <path d="M2 1.2v7.6L8.8 5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div className="flex" role="radiogroup" aria-label="Simulation speed">
        {([1, 4, 16] as const).map((x, k) => (
          <button
            key={x}
            type="button"
            role="radio"
            aria-checked={speed === x}
            data-on={speed === x}
            onClick={() => setSpeed(x)}
            className={cn("key-screen !px-2", k === 0 && "rounded-r-none", k === 1 && "rounded-none", k === 2 && "rounded-l-none")}
          >
            {x}×
          </button>
        ))}
      </div>
    </div>
  );
}

const VIEW_KEYS: { k: keyof ViewState; label: string; key: string }[] = [
  { k: "cutaway", label: "Cutaway", key: "C" },
  { k: "exploded", label: "Explode", key: "E" },
  { k: "flow", label: "Flow", key: "F" },
  { k: "labels", label: "Labels", key: "L" },
];

function ViewKeys() {
  const { view, toggleView, resetCamera } = useRuntime(useShallow((s) => ({ view: s.view, toggleView: s.toggleView, resetCamera: s.resetCamera })));
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="View">
      {VIEW_KEYS.map((v) => (
        <button key={v.k} type="button" className="key-screen" data-on={view[v.k]} aria-pressed={view[v.k]} onClick={() => toggleView(v.k)} title={`${v.label} (${v.key})`}>
          <span className="opacity-50">{v.key}</span>
          <span className="max-sm:sr-only">{v.label}</span>
        </button>
      ))}
      <button type="button" className="key-screen" onClick={resetCamera} title="Home view (V)" aria-label="Home view">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M6 1.5 1.5 5.2V10.5h3.2V7.6h2.6v2.9h3.2V5.2z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

function HeatLegend() {
  const marks = useRuntime(useShallow((s) => s.mod.bindings.legend?.(s.outputs).map((m) => `${m.label}:${m.tempF.toFixed(1)}`) ?? []));
  const frac = (t: number) => Math.min(1, Math.max(0, (t - LEGEND_LO) / (LEGEND_HI - LEGEND_LO)));
  // stagger labels that would collide: each goes in the lowest row whose last label is far enough left
  const rowEnds: number[] = [];
  const placed = marks
    .map((m) => {
      const k = m.lastIndexOf(":");
      return { label: m.slice(0, k), t: Number(m.slice(k + 1)) };
    })
    .sort((a, b) => a.t - b.t)
    .map((m) => {
      let row = rowEnds.findIndex((end) => frac(m.t) - end >= 0.09);
      if (row < 0) row = Math.min(rowEnds.length, 2);
      rowEnds[row] = frac(m.t);
      return { ...m, row };
    });
  return (
    <div className="w-[190px] max-sm:w-[150px]" aria-hidden>
      <div className="relative h-[28px]">
        {placed.map((m) => (
          <span
            key={m.label}
            className="absolute bottom-0 flex -translate-x-1/2 flex-col items-center transition-[left] duration-300"
            style={{ left: `${frac(m.t) * 100}%` }}
          >
            <span className="num text-[8.5px] leading-none tracking-wider text-stage-ink">{m.label}</span>
            {m.row > 0 && <span className="mt-[2px] w-px bg-stage-dim/70" style={{ height: 8 * m.row }} />}
            <span className="mt-[2px] h-0 w-0 border-x-[3px] border-t-[4px] border-x-transparent" style={{ borderTopColor: heatCss(m.t) }} />
          </span>
        ))}
      </div>
      <div className="h-[5px] rounded-full" style={{ background: heatGradient(LEGEND_LO, LEGEND_HI) }} />
      <div className="num mt-1 flex justify-between text-[8.5px] text-stage-dim">
        <span>{LEGEND_LO}°F</span>
        <span>50</span>
        <span>{LEGEND_HI}°F</span>
      </div>
    </div>
  );
}

/** A faint wash of outdoor-air color across the top of the stage: the weather the unit is breathing. */
function WeatherTint() {
  const oat = useRuntime((s) => Math.round((s.outputs.oat as number) ?? 60));
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 transition-[background] duration-700"
      style={{ background: `radial-gradient(90% 70% at 18% -10%, ${heatCss(oat, 0.22)} 0%, transparent 70%)` }}
    />
  );
}

function SceneDescription() {
  const text = useRuntime((s) => s.mod.bindings.describe?.(s.outputs) ?? "");
  return <p className="sr-only">{text}</p>;
}

/**
 * Memoized, with stable callbacks: re-rendering it re-renders the whole R3F tree, which re-bakes the
 * contact shadows and environment. Everything live inside subscribes to the store on its own.
 */
export const Display = memo(function Display({ compact, className }: { compact?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const pageVisible = usePageVisible();
  const reduced = useReducedMotion();
  const dark = useDarkScheme();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [snap, setSnap] = useState<{ url: string; fade: boolean } | null>(null);

  const onSnapshot = useCallback((url: string) => setSnap({ url, fade: false }), []);
  const onReady = useCallback(() => setLoaded(true), []);
  const onError = useCallback((e: Error) => setFailed(e.message), []);
  useEffect(() => {
    if (!snap || snap.fade) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setSnap((s) => (s ? { ...s, fade: true } : s))));
    return () => cancelAnimationFrame(id);
  }, [snap]);

  return (
    <div ref={ref} className={cn("stage relative isolate overflow-hidden", className)} role="group" aria-roledescription="3D equipment view" aria-label="Equipment view">
      <WeatherTint />
      <div className="absolute inset-0">
        <LabCanvas active={inView && pageVisible} reduced={reduced} dark={dark} compact={compact} onSnapshot={onSnapshot} onReady={onReady} onError={onError} />
      </div>
      {snap && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={snap.url}
          alt=""
          className="crossfade pointer-events-none absolute inset-0 size-full transition-opacity duration-300"
          style={{ opacity: snap.fade ? 0 : 1 }}
          onTransitionEnd={() => setSnap(null)}
        />
      )}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-500",
          loaded ? "opacity-0" : "opacity-100",
        )}
        aria-hidden={loaded}
      >
        <div className="num flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-stage-dim">
          {failed ? (
            <>
              <span className="led" data-state="fault" /> Equipment model unavailable
            </>
          ) : (
            <>
              <span className="led animate-pulse" data-state="accent" /> Loading equipment
            </>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 [&>*]:pointer-events-auto">
        <StatusChips />
        {!compact && <Transport />}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 [&>*]:pointer-events-auto">
        <ViewKeys />
        <div className="max-[420px]:hidden">
          <HeatLegend />
        </div>
      </div>
      <SceneDescription />
    </div>
  );
});
