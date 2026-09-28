"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fmt } from "./primitives";

export interface SetpointFieldProps {
  label: string;
  point: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  digits?: number;
  value: number;
  onChange: (v: number) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Setpoint with up/down nudge — an LCD window with Braun round keys. Shift = ×10. */
export function SetpointField({ label, point, unit, min, max, step, digits = 0, value, onChange }: SetpointFieldProps) {
  const id = useId();
  // what's typed in the LCD, or null to show the value. Mirrored in a ref because blur() fires
  // onBlur synchronously, before a setDraft from the same handler has re-rendered.
  const [draft, setDraftState] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const setDraft = (d: string | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const repeat = useRef<{ t?: number; i?: number }>({});
  const latest = useRef(value);
  latest.current = value;

  const snap = (v: number) => Number(clamp(Math.round(v / step) * step, min, max).toFixed(6));
  /** The typed number, if the draft is one */
  const typed = () => {
    const d = draftRef.current;
    const v = d === null || d.trim() === "" ? NaN : Number(d);
    return Number.isFinite(v) ? v : null;
  };

  const nudge = (dir: 1 | -1, mult = 1) => {
    // step from what's typed, if anything, so a nudge never throws away an edit
    const next = snap((typed() ?? latest.current) + dir * step * mult);
    latest.current = next;
    setDraft(null);
    onChange(next);
  };

  const stopRepeat = () => {
    window.clearTimeout(repeat.current.t);
    window.clearInterval(repeat.current.i);
  };
  const startRepeat = (dir: 1 | -1) => {
    stopRepeat();
    nudge(dir);
    repeat.current.t = window.setTimeout(() => {
      repeat.current.i = window.setInterval(() => nudge(dir), 70);
    }, 380);
  };
  useEffect(() => stopRepeat, []);

  const commit = () => {
    const v = typed();
    setDraft(null);
    if (v === null) return;
    const next = snap(v);
    if (next !== latest.current) onChange(next);
  };

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block truncate text-[13px] font-medium text-ink">
          {label}
        </label>
        <div className="micro mt-0.5 truncate">{point}</div>
      </div>
      <div className="flex flex-none items-center gap-2">
        <div className="screen relative flex h-10 w-[104px] items-center justify-end px-2.5 !shadow-[inset_0_2px_6px_rgba(0,0,0,.6),0_0_0_1px_var(--line-2)]">
          <input
            id={id}
            inputMode="decimal"
            className="num w-full min-w-0 bg-transparent text-right text-[19px] text-screen-ink outline-none"
            value={draft ?? fmt(value, digits)}
            onFocus={(e) => {
              setDraft(fmt(value, digits));
              requestAnimationFrame(() => e.target.select());
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(null);
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                nudge(e.key === "ArrowUp" ? 1 : -1, e.shiftKey ? 10 : 1);
              }
            }}
            role="spinbutton"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={`${fmt(value, digits)} ${unit}`}
          />
          <span className="num ml-1 w-4 text-[11px] text-screen-dim">{unit}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {([1, -1] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              className="round-key !size-[22px]"
              aria-label={`${dir > 0 ? "Raise" : "Lower"} ${label}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                startRepeat(dir);
              }}
              onPointerUp={stopRepeat}
              onPointerLeave={stopRepeat}
              onPointerCancel={stopRepeat}
              // keyboard and assistive tech (VoiceOver, voice control) activate with a click that has no pointer press
              onClick={(e) => {
                if (e.detail === 0) nudge(dir, e.shiftKey ? 10 : 1);
              }}
            >
              <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                <path d={dir > 0 ? "M1.5 6.8 5 3.2l3.5 3.6" : "M1.5 3.2 5 6.8l3.5-3.6"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
