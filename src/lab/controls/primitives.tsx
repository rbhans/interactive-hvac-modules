"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { PointStatus } from "../types";

export function Section({
  index,
  title,
  aside,
  className,
  children,
}: {
  index: string;
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("px-4 py-4", className)} aria-label={title}>
      <header className="mb-3 flex items-center gap-2">
        <span className="micro !text-ink">{index}</span>
        <h3 className="micro">{title}</h3>
        <span className="h-px flex-1 bg-line" aria-hidden />
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Led({ state, className, label }: { state: PointStatus | "off" | "accent"; className?: string; label?: string }) {
  return <span className={cn("led", className)} data-state={state} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

export function HandIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-3.5", className)} fill="currentColor" aria-hidden>
      <path d="M6.2 1.6c.5 0 .9.4.9.9v4.3h.4V1.9c0-.5.4-.9.9-.9s.9.4.9.9v4.9h.4V2.7c0-.5.4-.9.9-.9s.9.4.9.9v5.1h.3V4.6c0-.5.4-.9.9-.9s.9.4.9.9v5.2c0 3.1-2 5.4-4.9 5.4-2 0-3.2-.8-4.3-2.4L2.2 9.5c-.3-.5-.2-1 .2-1.3.4-.3 1-.2 1.3.2l1.6 1.9V2.5c0-.5.4-.9.9-.9Z" />
    </svg>
  );
}

export function StatusTag({ status }: { status: PointStatus }) {
  if (status === "ok") return null;
  const text = { fault: "FAULT", alarm: "ALARM", overridden: "OVRD" }[status];
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1 rounded-[4px] px-1 py-px text-[9px] tracking-[0.08em]",
        status === "fault" && "bg-fault/15 text-[color-mix(in_oklab,var(--fault)_75%,var(--ink))]",
        status === "alarm" && "bg-alarm/12 text-alarm",
        status === "overridden" && "bg-hand/12 text-hand",
      )}
    >
      {status === "overridden" && <HandIcon className="size-2.5" />}
      {text}
    </span>
  );
}

export function fmt(v: number, digits = 0) {
  if (!Number.isFinite(v)) return "—";
  const r = Number(v.toFixed(digits));
  return (Object.is(r, -0) ? 0 : r).toFixed(digits);
}
