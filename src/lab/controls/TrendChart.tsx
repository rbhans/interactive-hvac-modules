"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { TrendPen } from "../types";
import { fmt } from "./primitives";

export interface TrendChartProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pens: TrendPen<any>[];
  window: number;
  t: number[];
  series: Record<string, number[]>;
  now: number;
}

function niceRange(lo: number, hi: number, minSpan: number, step: number): [number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, minSpan];
  const mid = (lo + hi) / 2;
  const span = Math.max(minSpan, hi - lo);
  return [Math.floor((mid - span / 2 - step * 0.25) / step) * step, Math.ceil((mid + span / 2 + step * 0.25) / step) * step];
}

/** Rolling mini trend on an oscilloscope-style screen. Temperature on the left axis, % on the right. */
export function TrendChart({ pens, window: win, t, series, now }: TrendChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  // one clip rect per chart: a shared id would clip every chart on the page to the first one's size
  const clipId = `trend-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [size, setSize] = useState({ w: 320, h: 150 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 30, r: 30, t: 8, b: 16 };
  const W = Math.max(40, size.w - pad.l - pad.r);
  const H = Math.max(40, size.h - pad.t - pad.b);
  const t1 = Math.max(now, win);
  const t0 = t1 - win;

  const tempVals = pens.filter((p) => p.axis === "temp").flatMap((p) => series[p.id] ?? []);
  const [tLo, tHi] = niceRange(Math.min(...tempVals), Math.max(...tempVals), 8, 5);
  const [pLo, pHi] = [0, 100];

  const x = (tt: number) => pad.l + ((tt - t0) / win) * W;
  const y = (v: number, axis: "temp" | "pct") => {
    const [lo, hi] = axis === "temp" ? [tLo, tHi] : [pLo, pHi];
    return pad.t + H - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * H;
  };

  const tempTicks: number[] = [];
  const tStep = tHi - tLo > 30 ? 10 : 5;
  for (let v = tLo; v <= tHi + 1e-9; v += tStep) tempTicks.push(v);
  // until the window fills, the newest sample sits left of the right edge: label ticks from now, and none ahead of it
  const timeTicks: number[] = [];
  for (let s = Math.ceil(t0 / 15) * 15; s <= now + 1e-6; s += 15) timeTicks.push(s);

  const last = (id: string) => series[id]?.[series[id].length - 1];

  return (
    <div className="screen flex h-[280px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-2.5">
        {pens.map((p) => (
          <span key={p.id} className="num flex items-center gap-1.5 text-[10px] text-screen-dim">
            <svg width="14" height="4" aria-hidden>
              <line x1="0" y1="2" x2="14" y2="2" stroke={p.color} strokeWidth="2" strokeDasharray={p.dashed ? "3 2" : undefined} />
            </svg>
            {p.label}
            <span className="text-screen-ink">
              {fmt(last(p.id) ?? NaN, p.axis === "temp" ? 1 : 0)}
              {p.unit}
            </span>
          </span>
        ))}
      </div>
      <div ref={ref} className="relative min-h-0 flex-1">
        <svg width={size.w} height={size.h} className="absolute inset-0" role="img" aria-label={`Trend of ${pens.map((p) => p.label).join(", ")} over the last ${win} seconds`}>
          {tempTicks.map((v) => (
            <g key={`t${v}`}>
              <line x1={pad.l} x2={pad.l + W} y1={y(v, "temp")} y2={y(v, "temp")} stroke="var(--screen-line)" strokeWidth="1" />
              <text x={pad.l - 6} y={y(v, "temp") + 3} textAnchor="end" className="num" fontSize="9" fill="var(--screen-dim)">
                {v}°
              </text>
            </g>
          ))}
          {[0, 50, 100].map((v) => (
            <text key={`p${v}`} x={pad.l + W + 6} y={y(v, "pct") + 3} className="num" fontSize="9" fill="var(--screen-dim)">
              {v}%
            </text>
          ))}
          {timeTicks.map((s) => (
            <text key={`s${s}`} x={x(s)} y={pad.t + H + 12} textAnchor="middle" className="num" fontSize="8.5" fill="var(--screen-dim)">
              {Math.round(s - now) === 0 ? "now" : `${Math.round(s - now)}s`}
            </text>
          ))}
          <clipPath id={clipId}>
            <rect x={pad.l} y={pad.t - 2} width={W} height={H + 4} />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            {pens.map((p) => {
              const vals = series[p.id] ?? [];
              if (vals.length < 2) return null;
              // a value that doesn't exist (a point this equipment doesn't have right now) breaks the line
              let d = "";
              let down = false;
              vals.forEach((v, k) => {
                if (!Number.isFinite(v)) return void (down = false);
                d += `${down ? "L" : "M"}${x(t[k]).toFixed(1)} ${y(v, p.axis).toFixed(1)}`;
                down = true;
              });
              if (!d) return null;
              return (
                <path
                  key={p.id}
                  d={d}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={p.dashed ? 1.25 : 1.75}
                  strokeDasharray={p.dashed ? "4 3" : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
