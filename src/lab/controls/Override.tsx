"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { fmt, HandIcon } from "./primitives";

const PRIORITY_NAMES: Record<number, string> = {
  1: "Manual life safety",
  2: "Auto life safety",
  5: "Critical equipment",
  6: "Minimum on/off",
  8: "Manual operator",
  16: "Program",
};

/** BACnet 16-slot priority array, drawn as a step-sequencer row. */
export function PriorityArray({ slots, active }: { slots: Record<number, number | null>; active: number }) {
  return (
    <div>
      <div className="flex items-end gap-[3px]" role="list" aria-label="Priority array">
        {Array.from({ length: 16 }, (_, k) => {
          const p = k + 1;
          const v = slots[p];
          const has = v !== null && v !== undefined;
          const isActive = p === active;
          return (
            <div
              key={p}
              role="listitem"
              aria-label={`Priority ${p}${PRIORITY_NAMES[p] ? ` (${PRIORITY_NAMES[p]})` : ""}: ${has ? `${fmt(v!)} %${isActive ? ", active" : ""}` : "null"}`}
              className="flex flex-1 flex-col items-center gap-1"
            >
              <span
                className={cn(
                  "block h-[18px] w-full rounded-[3px] transition-colors duration-150",
                  !has && "bg-well",
                  has && !isActive && "bg-ink-3/45",
                  has && isActive && (p === 8 ? "bg-hand" : p < 8 ? "bg-alarm" : "bg-ink"),
                )}
                style={has && isActive ? { boxShadow: `0 0 8px ${p === 8 ? "var(--hand)" : "transparent"}` } : undefined}
              />
              <span className={cn("num text-[8px] leading-none", isActive ? "text-ink" : "text-ink-3", p !== 5 && p !== 8 && p !== 16 && p !== 1 && "max-sm:opacity-0")}>
                {p}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface OverrideProps {
  label: string;
  point: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  mode: "auto" | "manual";
  value: number;
  programValue: number;
  programPriority: number;
  activePriority: number;
  otherSlots?: Record<number, number | null>;
  onChange: (v: { mode: "auto" | "manual"; value: number }) => void;
}

/** Auto/Manual with a priority-8 write. Switching to manual starts from the live command (bumpless). */
export function Override({ label, point, unit, min, max, step, mode, value, programValue, programPriority, activePriority, otherSlots, onChange }: OverrideProps) {
  const id = useId();
  const manual = mode === "manual";
  const slots: Record<number, number | null> = { [programPriority]: programValue };
  if (manual) slots[8] = value;
  for (const [p, v] of Object.entries(otherSlots ?? {})) if (v !== null && Number.isFinite(v)) slots[Number(p)] = v;
  const safety = activePriority < 8;

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div id={id} className="text-[13px] font-medium text-ink">
            {label}
          </div>
          <div className="micro mt-0.5">{point}</div>
        </div>
        <div
          className={cn(
            "num flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[10px] tracking-[0.06em]",
            safety ? "bg-alarm text-white" : manual ? "bg-hand text-white" : "bg-well text-ink-2",
          )}
          aria-live="polite"
        >
          {manual && !safety && <HandIcon className="size-3" />}P{activePriority} · {safety ? "SAFETY" : manual ? "MANUAL" : "AUTO"}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        {/* Braun slide switch */}
        <div role="radiogroup" aria-labelledby={id} className="well relative grid h-9 w-[124px] flex-none grid-cols-2 p-[3px]">
          <span
            aria-hidden
            className="absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-[6px] bg-key shadow-[0_0_0_1px_var(--key-edge),0_2px_3px_-1px_var(--key-shadow)] transition-transform duration-200 ease-out"
            style={{ transform: manual ? "translateX(100%)" : undefined }}
          />
          {(["auto", "manual"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={cn("num relative z-10 text-[10px] tracking-[0.1em]", mode === m ? "text-ink" : "text-ink-3")}
              onClick={() => onChange({ mode: m, value: m === "manual" && !manual ? Math.round(programValue) : value })}
            >
              {m === "auto" ? "AUTO" : "MAN"}
            </button>
          ))}
        </div>

        <div className={cn("flex min-w-0 flex-1 items-center gap-2 transition-opacity", !manual && "pointer-events-none opacity-35")}>
          <input
            type="range"
            className="fader min-w-0 flex-1"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={!manual}
            aria-label={`${label} manual value`}
            aria-valuetext={`${fmt(value)} ${unit}`}
            onChange={(e) => onChange({ mode, value: Number(e.target.value) })}
          />
          <span className="num w-11 text-right text-[15px] text-ink">
            {fmt(value)}
            <span className="text-[10px] text-ink-3">{unit}</span>
          </span>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="micro" title="BACnet priority array: the lowest-numbered command wins">
            Priority · lowest wins
          </span>
          <span className="num text-[10px] text-ink-3">
            P{programPriority} program <span className="text-ink">{fmt(programValue)}{unit}</span>
          </span>
        </div>
        <PriorityArray slots={slots} active={activePriority} />
      </div>
    </div>
  );
}
