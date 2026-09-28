"use client";

import { useId, useMemo } from "react";
import { fmt } from "@/lab/controls/primitives";
import { activeCoil, COILS, coilCurve, valveFlow, VALVE_SIZES, type CoilInputs, type CoilOutputs } from "./model";

const W = 260;
const H = 172;
const P = { l: 30, r: 10, t: 20, b: 24 };
const IW = W - P.l - P.r;
const IH = H - P.t - P.b;
const X = (v: number) => P.l + (v / 100) * IW;
const Y = (v: number) => P.t + IH - (Math.min(100, Math.max(0, v)) / 100) * IH;

function path(f: (x: number) => number) {
  let d = "";
  for (let k = 0; k <= 60; k++) {
    const x = (k / 60) * 100;
    d += `${k ? "L" : "M"}${X(x).toFixed(1)} ${Y(f(x)).toFixed(1)}`;
  }
  return d;
}

function Grid({ xLabel, yLabel }: { xLabel: string; yLabel: string }) {
  return (
    <>
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={X(0)} x2={X(100)} y1={Y(v)} y2={Y(v)} stroke="var(--screen-line)" />
          <line x1={X(v)} x2={X(v)} y1={Y(0)} y2={Y(100)} stroke="var(--screen-line)" />
          <text x={X(0) - 6} y={Y(v) + 3} textAnchor="end" fontSize="8.5" className="num" fill="var(--screen-dim)">
            {v}
          </text>
          <text x={X(v)} y={Y(0) + 11} textAnchor="middle" fontSize="8.5" className="num" fill="var(--screen-dim)">
            {v}
          </text>
        </g>
      ))}
      <text x={X(100)} y={H - 3} textAnchor="end" fontSize="8" className="num" fill="var(--screen-dim)" letterSpacing=".08em">
        {xLabel}
      </text>
      <text x={4} y={10} fontSize="8" className="num" fill="var(--screen-dim)" letterSpacing=".08em">
        {yLabel}
      </text>
      <line x1={X(0)} y1={Y(0)} x2={X(100)} y2={Y(100)} stroke="var(--screen-dim)" strokeDasharray="3 3" />
    </>
  );
}

/**
 * The module's two instruments: the coil's own curve (water → heat, the insight) with the live
 * operating point, and the valve's curve (opening → water and opening → heat) with its switches.
 */
export function CoilCurve({
  inputs,
  outputs,
  setInputs,
}: {
  inputs: CoilInputs;
  outputs: CoilOutputs;
  setInputs: (fn: (i: CoilInputs) => CoilInputs) => void;
}) {
  const id = useId();
  const cooling = inputs.mode === "cooling";
  const spec = COILS[activeCoil(inputs.mode)];
  const air = inputs.airflow / 100;
  const ewt = cooling ? inputs.chwEwt : inputs.hwEwt;
  const eat = cooling ? outputs.afterHw : inputs.eat;
  const maxFlow = VALVE_SIZES[inputs.valveSize].maxFlow;
  const heat = cooling ? "cooling" : "heat";

  // quantize the entering conditions so the curves don't rebuild on every tick
  const key = `${spec.id}|${Math.round(eat)}|${Math.round(ewt)}|${inputs.airflow}|${inputs.valveChar}|${inputs.valveSize}`;
  const curves = useMemo(() => {
    const coil = path((w) => coilCurve(spec, eat, ewt, (w / 100) * maxFlow, air, maxFlow) * 100);
    const valve = path((x) => (valveFlow(x / 100, inputs.valveChar, inputs.valveSize) / maxFlow) * 100);
    const combined = path((x) => coilCurve(spec, eat, ewt, valveFlow(x / 100, inputs.valveChar, inputs.valveSize), air, maxFlow) * 100);
    return { coil, valve, combined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const water = outputs.flowOfMax;
  const cap = Math.max(0, outputs.capOfMax);
  const stem = outputs.stemPct;

  return (
    <div>
      <div className="num text-[28px] leading-none tracking-tight text-ink">
        {fmt(water)}
        <span className="text-[14px] text-ink-3">%</span>
        <span className="mx-1.5 text-[18px] text-ink-3" aria-hidden>
          →
        </span>
        <span className="text-accent">{fmt(cap)}</span>
        <span className="text-[14px] text-ink-3">%</span>
      </div>
      <div className="micro mt-1.5">
        Water flowing → {heat} delivered, of what the coil can do
      </div>

      <div className="screen mt-3 max-w-[440px] overflow-hidden p-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-labelledby={`${id}-a`}>
          <title id={`${id}-a`}>{`The coil's curve: ${fmt(water)} % of full water flow delivers ${fmt(cap)} % of the ${heat} the coil can do right now.`}</title>
          <Grid xLabel="WATER %" yLabel={`${heat.toUpperCase()} %`} />
          <path d={curves.coil} fill="none" stroke="var(--accent)" strokeWidth="2" />
          <path d={`M${X(water)} ${Y(0)} V${Y(cap)} H${X(0)}`} fill="none" stroke="var(--screen-ink)" strokeOpacity=".55" strokeDasharray="2 2" />
          <circle cx={X(water)} cy={Y(cap)} r="4.5" fill="var(--accent)" stroke="var(--screen)" strokeWidth="1.5" />
        </svg>
      </div>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="micro">The valve</span>
        <span className="num text-[11px] text-ink-3">
          {fmt(stem)}% open → {fmt(water)}% water → {fmt(cap)}% {heat}
        </span>
      </div>
      <div className="screen mt-2 max-w-[440px] overflow-hidden p-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-labelledby={`${id}-b`}>
          <title id={`${id}-b`}>{`Valve curve: ${fmt(stem)} % open passes ${fmt(water)} % of full flow and delivers ${fmt(cap)} % of full ${heat}.`}</title>
          <Grid xLabel="VALVE OPEN %" yLabel="% OF FULL" />
          <path d={curves.valve} fill="none" stroke="#27b7ff" strokeWidth="1.5" strokeDasharray="4 3" />
          <path d={curves.combined} fill="none" stroke="var(--accent)" strokeWidth="2" />
          <circle cx={X(stem)} cy={Y(water)} r="3.5" fill="#27b7ff" stroke="var(--screen)" strokeWidth="1.5" />
          <circle cx={X(stem)} cy={Y(cap)} r="4.5" fill="var(--accent)" stroke="var(--screen)" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10.5px]">
        <span className="num flex items-center gap-1.5 text-ink-3">
          <svg width="14" height="4" aria-hidden>
            <line x1="0" y1="2" x2="14" y2="2" stroke="#27b7ff" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          water
        </span>
        <span className="num flex items-center gap-1.5 text-ink-3">
          <span className="inline-block h-[2px] w-3.5 bg-accent" /> {heat}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3">
        <span className="micro" id={`${id}-c`}>
          Shape
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-c`} className="flex gap-1.5">
          {(
            [
              ["equal", "Equal %"],
              ["linear", "Linear"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={inputs.valveChar === v}
              data-on={inputs.valveChar === v}
              className="key flex-1 !min-h-[28px] !px-2 !text-[10px]"
              onClick={() => setInputs((i) => ({ ...i, valveChar: v }))}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="micro" id={`${id}-d`}>
          Size
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-d`} className="flex gap-1.5">
          {(
            [
              ["right", "Right-sized"],
              ["oversized", "Oversized"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={inputs.valveSize === v}
              data-on={inputs.valveSize === v}
              className="key flex-1 !min-h-[28px] !px-2 !text-[10px]"
              onClick={() => setInputs((i) => ({ ...i, valveSize: v }))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
        An equal-percentage valve opens slowly at first, which cancels out the coil&rsquo;s eager start, so opening and {heat} track
        each other. A linear or oversized valve does almost everything in the first bit of travel.
      </p>
    </div>
  );
}
