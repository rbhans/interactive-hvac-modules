"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Led } from "./primitives";

function Screw({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={cn("size-3 text-ink-3", className)} aria-hidden>
      <circle cx="6" cy="6" r="5" fill="var(--panel-2)" stroke="currentColor" strokeOpacity=".5" />
      <path d="M3.2 6h5.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" transform="rotate(35 6 6)" />
    </svg>
  );
}

/** The service panel: fault injection lives behind two screws. */
export function FaultDrawer({ active, children }: { active: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="well overflow-hidden !rounded-[10px]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <Screw />
        <span className="micro !text-ink-2">Service panel</span>
        <span className="flex-1" />
        {active > 0 && (
          <span className="num flex items-center gap-1.5 text-[10px] text-ink-2">
            <Led state="fault" />
            {active} fault{active > 1 ? "s" : ""}
          </span>
        )}
        <svg viewBox="0 0 10 10" className={cn("size-2.5 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden>
          <path d="M1.5 3.2 5 6.8l3.5-3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <Screw className="rotate-90" />
      </button>
      <div
        id={id}
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        inert={!open}
      >
        <div className="min-h-0">
          <div className="space-y-4 border-t border-dashed border-line-2 px-3 pb-3.5 pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function FaultSwitch({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={id}
        aria-describedby={`${id}-h`}
        onClick={() => onChange(!on)}
        className={cn(
          "relative mt-0.5 h-5 w-9 flex-none rounded-full transition-colors",
          on ? "bg-fault" : "bg-line-2",
        )}
      >
        <span
          className="absolute left-0.5 top-0.5 size-4 rounded-full bg-key shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-transform duration-200"
          style={{ transform: on ? "translateX(16px)" : undefined }}
        />
      </button>
      <div className="min-w-0">
        <div id={id} className="text-[13px] font-medium text-ink">
          {label}
        </div>
        <p id={`${id}-h`} className="mt-0.5 text-[12px] leading-snug text-ink-3">
          {hint}
        </p>
      </div>
    </div>
  );
}
