"use client";

import { useId, useRef } from "react";
import { fmt } from "./primitives";

const COLORS = {
  orange: { body: "#ff5a1f", ring: "#d9400c", dot: "#fff" },
  blue: { body: "#2c5bff", ring: "#1d3fcc", dot: "#fff" },
  green: { body: "#2e9e57", ring: "#1f7a41", dot: "#fff" },
  white: { body: "#f4f1ea", ring: "#c9c4b9", dot: "#161616" },
};

const START = 135; // degrees, measured clockwise from +x (screen)
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export interface KnobProps {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  digits?: number;
  color?: keyof typeof COLORS;
  warnAbove?: number;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  /** Double-click returns the knob here (the loaded preset's value) */
  resetTo?: number;
}

/** Rotary encoder, TE-style. Drag vertically (Shift = fine), or use arrow keys (Shift = ×10). Double-click resets. */
export function Knob({ label, unit, min, max, step, digits = 1, color = "orange", warnAbove, value, onChange, hint, resetTo }: KnobProps) {
  const id = useId();
  const drag = useRef<{ y: number; v: number; fine: boolean } | null>(null);
  const c = COLORS[color];
  const norm = (v: number) => (v - min) / (max - min);
  const angle = START + norm(value) * SWEEP;
  const warnAngle = warnAbove !== undefined ? START + norm(warnAbove) * SWEEP : undefined;
  const warn = warnAbove !== undefined && value > warnAbove;

  const set = (v: number) => {
    const q = Math.round(v / step) * step;
    onChange(Number(Math.min(max, Math.max(min, q)).toFixed(6)));
  };

  const [ix, iy] = polar(32, 32, 14, angle);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        role="slider"
        tabIndex={0}
        aria-labelledby={id}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${fmt(value, digits)} ${unit}${warn ? ", too high" : ""}`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="relative size-16 cursor-ns-resize touch-none rounded-full outline-offset-4"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, v: value, fine: e.shiftKey };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          // a release the page never saw (a context menu, a window switch) ends the drag
          if (e.pointerType === "mouse" && !(e.buttons & 1)) {
            drag.current = null;
            return;
          }
          // Shift pressed or released mid-drag: carry on from here at the new rate, rather than rescaling the whole drag
          if (e.shiftKey !== drag.current.fine) drag.current = { y: e.clientY, v: value, fine: e.shiftKey };
          const dy = drag.current.y - e.clientY;
          set(drag.current.v + (dy / 160) * (max - min) * (drag.current.fine ? 0.2 : 1));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onLostPointerCapture={() => (drag.current = null)}
        onDoubleClick={() => resetTo !== undefined && set(resetTo)}
        onKeyDown={(e) => {
          const big = e.shiftKey ? 10 : 1;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") set(value + step * big);
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(value - step * big);
          else if (e.key === "Home") set(min);
          else if (e.key === "End") set(max);
          else return;
          e.preventDefault();
        }}
      >
        <svg viewBox="0 0 64 64" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <path d={arc(32, 32, 29, START, START + SWEEP)} fill="none" stroke="var(--well)" strokeWidth="3" strokeLinecap="round" />
          {warnAngle !== undefined && (
            <path d={arc(32, 32, 29, warnAngle, START + SWEEP)} fill="none" stroke="var(--fault)" strokeOpacity="0.45" strokeWidth="3" strokeLinecap="round" />
          )}
          <path
            d={arc(32, 32, 29, START, Math.max(START + 0.01, angle))}
            fill="none"
            stroke={warn ? "var(--fault)" : "var(--ink)"}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="32" cy="33.5" r="21" fill="rgba(0,0,0,.18)" />
          <circle cx="32" cy="32" r="21" fill={c.ring} />
          <circle cx="32" cy="31" r="19.5" fill={c.body} />
          <circle cx={ix} cy={iy} r="2.6" fill={c.dot} />
        </svg>
      </div>
      <div className="text-center">
        <div className="num text-[14px] leading-none text-ink">
          {fmt(value, digits)}
          <span className="ml-0.5 text-[10px] text-ink-3">{unit}</span>
        </div>
        <div id={id} className="micro mt-1">
          {label}
        </div>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="sr-only">
          {hint}
        </p>
      )}
    </div>
  );
}
