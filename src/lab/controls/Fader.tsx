"use client";

import { useId } from "react";
import { fmt } from "./primitives";

export interface FaderProps {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  marks?: { label: string; value: number }[];
  hint?: string;
  digits?: number;
}

/** Analog slider for simulated conditions — a Braun hi-fi fader with a printed scale. */
export function Fader({ label, unit, min, max, step, value, onChange, marks = [], hint, digits = 0 }: FaderProps) {
  const id = useId();
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const span = max - min;
  const major = span <= 30 ? 5 : span <= 60 ? 10 : 20;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / (major / 2)) * (major / 2); t <= max + 1e-9; t += major / 2) ticks.push(t);

  return (
    <div className="group">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        <output htmlFor={id} className="num text-[15px] text-ink">
          {fmt(value, digits)}
          <span className="ml-0.5 text-[11px] text-ink-3">{unit}</span>
        </output>
      </div>

      <div className="relative mt-1">
        {/* thumb is 16px wide, so the usable track is inset by 8px each side */}
        <div className="pointer-events-none absolute inset-x-2 top-0 h-8">
          {marks.map((m) => (
            <span
              key={m.label}
              className="absolute -top-[1px] flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${Math.min(100, Math.max(0, pct(m.value)))}%` }}
            >
              <span className="num whitespace-nowrap text-[8.5px] leading-none tracking-wider text-ink-3">{m.label}</span>
              <span className="mt-[1px] h-0 w-0 border-x-[3.5px] border-t-[4px] border-x-transparent border-t-accent" />
            </span>
          ))}
        </div>
        <input
          id={id}
          type="range"
          className="fader relative"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-valuetext={`${fmt(value, digits)} ${unit}`}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <div className="pointer-events-none relative mx-2 h-3" aria-hidden>
          {ticks.map((t) => {
            const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
            return (
              <span
                key={t}
                className="absolute top-0 w-px -translate-x-1/2 bg-line-2"
                style={{ left: `${pct(t)}%`, height: isMajor ? 6 : 3 }}
              />
            );
          })}
        </div>
        <div className="num relative mx-2 flex justify-between text-[9px] text-ink-3" aria-hidden>
          <span>{min}</span>
          <span>{max}</span>
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
