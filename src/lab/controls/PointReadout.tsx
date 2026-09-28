"use client";

import { cn } from "@/lib/utils";
import type { PointStatus } from "../types";
import { fmt, Led, StatusTag } from "./primitives";

export interface PointReadoutProps {
  point: string;
  label: string;
  value: number;
  unit: string;
  digits?: number;
  status?: PointStatus;
  pair?: { label: string; value: number };
  reality?: boolean;
}

/**
 * One row of the point list: status, name, value and units, with an optional
 * command/feedback pair. Reality rows are what the BAS can't see.
 */
export function PointReadout({ point, label, value, unit, digits = 0, status = "ok", pair, reality }: PointReadoutProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2.5 py-2",
        reality ? "text-ink-2" : "text-ink",
      )}
    >
      {reality ? (
        <span className="size-[7px] rounded-full border border-dashed border-ink-3" aria-hidden />
      ) : (
        <Led state={status} label={`status ${status}`} />
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn("num truncate text-[11px] tracking-[0.04em]", reality ? "text-ink-3" : "text-ink")}>{point}</span>
          <StatusTag status={status} />
        </div>
        <div className="truncate text-[11.5px] text-ink-3">{label}</div>
      </div>
      <div className="text-right">
        <div className="num text-[17px] leading-tight">
          {fmt(value, digits)}
          <span className="ml-0.5 text-[10px] text-ink-3">{unit}</span>
        </div>
        {pair && (
          <div className="num text-[10.5px] text-ink-3">
            {pair.label} <span className="text-ink-2">{fmt(pair.value, digits)}{unit}</span>
          </div>
        )}
      </div>
    </div>
  );
}
