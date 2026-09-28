"use client";

import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { useRuntime } from "./runtime";

/**
 * Preset keys. A grid sized by its container, so every preset is always visible:
 * one row when there's room, wrapping to 3×2 or 2×3 when there isn't. No hidden overflow.
 */
export function PresetsBar({ compact }: { compact?: boolean }) {
  const { presets, presetId, dirty, applyPreset, reset, cue } = useRuntime(
    useShallow((s) => ({ presets: s.mod.presets, presetId: s.presetId, dirty: s.dirty, applyPreset: s.applyPreset, reset: s.reset, cue: s.cue })),
  );
  const [cueKey, setCueKey] = useState(0);
  useEffect(() => setCueKey((k) => k + 1), [cue?.at]);

  return (
    <div className="@container">
      <div
        className="grid grid-cols-2 gap-2 @md:grid-cols-3 @3xl:[grid-template-columns:repeat(var(--n),minmax(0,1fr))]"
        style={{ "--n": presets.length } as React.CSSProperties}
        role="toolbar"
        aria-label="Presets"
      >
        {presets.map((p, k) => {
          const on = presetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              data-on={on && !dirty}
              aria-pressed={on}
              onClick={() => applyPreset(p.id)}
              title={`${p.label} (${k + 1})`}
              className="key !h-auto min-w-0 flex-col !items-start !justify-start !gap-0 !px-3 !py-2 text-left"
            >
              <span className="flex w-full items-center gap-1.5">
                <span className={cn("num text-[10px]", on && !dirty ? "opacity-60" : "text-ink-3")}>{String(k + 1).padStart(2, "0")}</span>
                <span className="flex-1" />
                {p.breakIt && (
                  <span
                    className={cn(
                      "whitespace-nowrap rounded-[3px] px-1 text-[8px] tracking-[0.1em]",
                      on && !dirty ? "bg-fault text-black" : "bg-fault/20 text-[color-mix(in_oklab,var(--fault)_70%,var(--ink))]",
                    )}
                  >
                    BREAK IT
                  </span>
                )}
                {on && dirty && <span className="led" data-state="accent" title="Modified" />}
              </span>
              <span className="mt-1.5 font-sans text-[13px] font-medium leading-tight normal-case tracking-normal text-balance">{p.label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2.5 flex items-start gap-3">
        {/* the live region stays put; only its content is re-keyed to replay the animation, so screen readers announce each cue */}
        <div className="min-h-[20px] flex-1" aria-live="polite">
          <p key={cueKey} className="flex items-baseline gap-2 text-[13.5px] leading-snug text-ink-2 motion-safe:animate-[cue-in_380ms_ease-out]">
            {cue && (
              <>
                <span className="micro flex-none !text-accent">Look for</span>
                <span>{cue.text}</span>
              </>
            )}
          </p>
        </div>
        {!compact && (
          <button type="button" className="key !min-h-[28px] flex-none !px-2.5 !text-[10px]" onClick={reset} title="Reset (R)" aria-label="Reset module">
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
              <path d="M2.2 6.2a3.8 3.8 0 1 0 1.2-2.8M2.2 1.6v2.2h2.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
