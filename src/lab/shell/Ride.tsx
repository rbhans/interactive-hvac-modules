"use client";

import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { heatCss } from "../heat";
import { useRuntime } from "./runtime";

function Molecule({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={className} aria-hidden>
      <circle cx="5" cy="7.5" r="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10.2" cy="4.2" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10.6" cy="10.6" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** "Be the air": starts a first-person ride. With more than one inlet, it asks where to start. */
export function RideButton() {
  const { starts, startRide } = useRuntime(useShallow((s) => ({ starts: s.mod.bindings.ride?.starts ?? [], startRide: s.startRide })));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!starts.length) return null;
  const go = (id: string) => {
    setOpen(false);
    startRide(id);
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="key-screen"
        aria-haspopup={starts.length > 1 ? "menu" : undefined}
        aria-expanded={starts.length > 1 ? open : undefined}
        onClick={() => (starts.length > 1 ? setOpen((v) => !v) : go(starts[0].id))}
        title="Ride through the unit as a bit of air (A)"
      >
        <Molecule className="size-3.5" />
        <span className="max-sm:sr-only">Be the air</span>
      </button>
      {open && (
        <div role="menu" className="absolute bottom-[calc(100%+8px)] left-0 z-20 w-[250px] rounded-[12px] bg-black/75 p-1.5 text-white shadow-[0_18px_40px_-16px_rgba(0,0,0,.7)] backdrop-blur-md">
          <p className="num px-2.5 pb-1 pt-1.5 text-[9.5px] uppercase tracking-[0.12em] text-white/55">Start as</p>
          {starts.map((s) => (
            <button key={s.id} type="button" role="menuitem" onClick={() => go(s.id)} className="block w-full rounded-[8px] px-2.5 py-2 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none">
              <span className="block text-[13.5px] font-medium">{s.label}</span>
              {s.hint && <span className="mt-0.5 block text-[12px] leading-snug text-white/60">{s.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const glass = "rounded-[12px] bg-black/55 text-white shadow-[0_12px_32px_-18px_rgba(0,0,0,.8)] backdrop-blur-md";

/** The first-person readout: where you are, what's happening to you, and where you ended up. */
export function RideHud() {
  const { hud, ride, starts, startRide, endRide } = useRuntime(
    useShallow((s) => ({ hud: s.rideHud, ride: s.ride, starts: s.mod.bindings.ride?.starts ?? [], startRide: s.startRide, endRide: s.endRide })),
  );
  if (!ride) return null;
  const t = hud?.tempF ?? 70;
  return (
    <div className="absolute inset-0">
      {/* the edge of your vision takes on your temperature */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-[background] duration-700"
        style={{ background: `radial-gradient(130% 110% at 50% 50%, transparent 52%, ${heatCss(t, 0.42)} 100%)` }}
      />

      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className={`${glass} max-w-[min(420px,70%)] px-3.5 py-2.5`} aria-live="polite">
          <p className="num flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.12em] text-white/60">
            <Molecule className="size-3" /> You are air · {hud?.start ?? "finding a path"}
          </p>
          <p className="mt-1 text-[17px] font-semibold leading-tight tracking-[-0.01em] sm:text-[22px]">{hud?.zone ?? "…"}</p>
          {hud?.note && <p className="mt-1 line-clamp-3 text-[12px] leading-snug text-white/75 sm:line-clamp-none sm:text-[13.5px]">{hud.note}</p>}
        </div>
        <button type="button" onClick={endRide} className={`${glass} num shrink-0 px-3 py-2 text-[10.5px] uppercase tracking-[0.1em] hover:bg-black/70`}>
          <span className="text-white/50">Esc</span> Leave
        </button>
      </div>

      {hud && (
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className={`${glass} flex items-center gap-4 px-3.5 py-2.5`}>
            <div className="flex items-baseline gap-2">
              <span className="size-2.5 self-center rounded-full" style={{ background: heatCss(t) }} />
              <span className="num text-[22px] leading-none tabular-nums">{t.toFixed(1)}</span>
              <span className="num text-[11px] text-white/60">°F · you</span>
            </div>
            <div className="num hidden text-[11px] tabular-nums text-white/60 sm:block">{Math.round(hud.fpm / 10) * 10} ft/min</div>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label="Trip" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hud.progress * 100)}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${hud.progress * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {hud?.done && (
        <div className="absolute inset-0 grid place-items-center p-4">
          <div className={`${glass} w-[min(400px,100%)] bg-black/70 p-5 text-center`} role="dialog" aria-label="Trip over">
            <p className="num text-[9.5px] uppercase tracking-[0.12em] text-white/55">Trip over</p>
            <p className="mt-1.5 text-[22px] font-semibold tracking-[-0.01em]">{hud.done.label}</p>
            <p className="mt-2 text-[13.5px] leading-snug text-white/75">{hud.done.note}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {starts.map((s) => (
                <button key={s.id} type="button" onClick={() => startRide(s.id)} className="key !min-h-[32px] !px-3 !text-[10.5px]" data-on={s.id === ride.start}>
                  {starts.length > 1 ? `Again · ${s.label}` : "Ride again"}
                </button>
              ))}
              <button type="button" onClick={endRide} className="key !min-h-[32px] !px-3 !text-[10.5px]">
                Back to the unit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
