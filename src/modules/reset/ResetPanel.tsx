"use client";

import { useId } from "react";
import { fmt } from "@/lab/controls/primitives";
import { useRuntime } from "@/lab/shell/runtime";
import { LOG_LENGTH, PHYSICS, ZONES, zo, type ResetInputs, type ResetOutputs, type ResetStep } from "./model";

const W = 260;
const H = 132;
const P = { l: 30, r: 10, t: 14, b: 18 };
const IW = W - P.l - P.r;
const IH = H - P.t - P.b;

/** Damper bars: each box's actuator feedback, with Guideline 36's request lines */
const BAR_H = 92;

function Staircase({ log, spMax, spMin, live }: { log: ResetStep[]; spMax: number; spMin: number; live: number }) {
  const id = useId();
  // scaled to what the log holds, so a sawtooth of a few hundredths still reads; the maximum is marked
  // at the top edge when it's off the chart
  const hiSeen = Math.max(live, ...log.map((e) => e.sp));
  const top = Math.min(Math.ceil(spMax * 4) / 4, Math.max(0.5, Math.ceil(hiSeen * 1.25 * 4) / 4));
  const x = (k: number) => P.l + (k / LOG_LENGTH) * IW;
  const y = (v: number) => P.t + IH - (Math.min(top, Math.max(0, v)) / top) * IH;
  const ticks: number[] = [];
  const tStep = top > 1 ? 0.5 : 0.25;
  for (let v = 0; v <= top + 1e-9; v += tStep) ticks.push(v);
  // newest step at the right edge; the line carries on flat to "now" at the live setpoint
  const off = LOG_LENGTH - log.length;
  let d = "";
  log.forEach((e, k) => {
    const prev = k === 0 ? e.sp : log[k - 1].sp;
    d += k === 0 ? `M${x(off).toFixed(1)} ${y(prev).toFixed(1)}` : "";
    d += `L${x(off + k).toFixed(1)} ${y(prev).toFixed(1)}L${x(off + k).toFixed(1)} ${y(e.sp).toFixed(1)}`;
  });
  if (log.length) d += `L${x(LOG_LENGTH).toFixed(1)} ${y(live).toFixed(1)}`;
  const last = log[log.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-labelledby={`${id}-t`}>
      <title id={`${id}-t`}>
        {last
          ? `The static pressure setpoint over the last ${log.length} steps: now ${live.toFixed(2)} in. Its last step ${last.action < 0 ? "trimmed it" : last.action > 0 ? `responded to ${last.r} requests` : "held it fixed"}.`
          : "The static pressure setpoint: no steps yet."}
      </title>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={P.l} x2={P.l + IW} y1={y(v)} y2={y(v)} stroke="var(--screen-line)" />
          <text x={P.l - 6} y={y(v) + 3} textAnchor="end" fontSize="8.5" className="num" fill="var(--screen-dim)">
            {v.toFixed(v % 0.5 === 0 ? 1 : 2)}
          </text>
        </g>
      ))}
      <text x={P.l + IW} y={H - 4} textAnchor="end" fontSize="8" className="num" fill="var(--screen-dim)" letterSpacing=".08em">
        {`IN. W.C. · LAST ${LOG_LENGTH} STEPS, ${PHYSICS.period} S APART`}
      </text>
      {/* the fixed setpoint it replaces, and the floor */}
      {spMax <= top + 1e-9 ? (
        <>
          <line x1={P.l} x2={P.l + IW} y1={y(spMax)} y2={y(spMax)} stroke="var(--screen-ink)" strokeOpacity=".55" strokeDasharray="3 3" />
          <text x={P.l + IW} y={y(spMax) - 3} textAnchor="end" fontSize="8" className="num" fill="var(--screen-dim)">
            {`MAX ${spMax.toFixed(2)}`}
          </text>
        </>
      ) : (
        <text x={P.l + IW} y={P.t - 4} textAnchor="end" fontSize="8" className="num" fill="var(--screen-dim)">
          {`MAX ${spMax.toFixed(2)} ↑`}
        </text>
      )}
      <line x1={P.l} x2={P.l + IW} y1={y(spMin)} y2={y(spMin)} stroke="var(--screen-line)" strokeDasharray="1 3" />
      {d && <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" />}
      {log.map((e, k) =>
        e.action > 0 && e.sp > (k ? log[k - 1].sp : e.sp - e.r) + 1e-9 ? (
          <g key={e.t}>
            <circle cx={x(off + k)} cy={y(e.sp)} r="2.6" fill="var(--accent)" />
            {e.r > 1 && (
              <text x={x(off + k)} y={y(e.sp) - 5} textAnchor="middle" fontSize="7.5" className="num" fill="var(--screen-ink)">
                {e.r}
              </text>
            )}
          </g>
        ) : null,
      )}
    </svg>
  );
}

function Stat({ value, unit, label, accent }: { value: string; unit: string; label: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`num text-[26px] leading-none tracking-tight ${accent ? "text-accent" : "text-ink"}`}>
        {value}
        <span className="text-[13px] text-ink-3"> {unit}</span>
      </div>
      <div className="micro mt-1">{label}</div>
    </div>
  );
}

function ReqDots({ n, counted }: { n: number; counted: boolean }) {
  return (
    <span className="flex gap-[3px]" aria-hidden>
      {[1, 2, 3].map((k) => (
        <span
          key={k}
          className="block size-[6px] rounded-full"
          style={{
            background: k <= n ? (counted ? (n >= 2 ? "var(--fault)" : "var(--accent)") : "var(--screen-dim)") : "transparent",
            boxShadow: "inset 0 0 0 1px var(--screen-line)",
          }}
        />
      ))}
    </span>
  );
}

/**
 * The module's instrument: the setpoint's steps (trims down, responses up), each box's damper against
 * the lines where it starts and stops asking, its requests, and the switch that ignores a zone.
 */
export function ResetPanel({
  outputs: o,
  setInputs,
}: {
  inputs: ResetInputs;
  outputs: ResetOutputs;
  setInputs: (fn: (i: ResetInputs) => ResetInputs) => void;
}) {
  const log = useRuntime((s) => (s.state as { log?: ResetStep[] }).log ?? []);
  const reset = o.reset === 1;
  const excess = o.requests - o.ignores;
  const next =
    o.nextAction < 0
      ? `trim −${o.trim.toFixed(2)} in.`
      : o.nextAction > 0
        ? `respond +${Math.min(o.respondMax, o.respond * excess).toFixed(2)} in.`
        : o.atMax
          ? "hold at the maximum"
          : "hold at the minimum";

  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Stat value={o.sp.toFixed(2)} unit="in." label="Setpoint" />
        <Stat value={o.kw.toFixed(2)} unit="kW" label="Fan power" />
        {reset && <Stat value={fmt(Math.max(0, o.savedPct))} unit="%" label="Saved vs. fixed" accent={o.savedPct > 5} />}
      </div>
      <div className="micro mt-2.5">
        {reset ? `Next step in ${Math.ceil(o.nextIn)} s: ${next}` : `Fixed at ${o.spMax.toFixed(2)} in., whatever the boxes need`}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="micro">The setpoint, step by step</span>
      </div>
      <div className="screen mt-2 max-w-[440px] overflow-hidden p-1">
        <Staircase log={log} spMax={o.spMax} spMin={o.spMin} live={o.sp} />
      </div>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="micro">Who&apos;s asking</span>
        <span className="num text-[11px] text-ink-3">
          {reset
            ? `R ${o.requests} − I ${o.ignores} ${excess > 0 ? `= ${excess} → respond` : "→ trim"}`
            : "requests not used"}
        </span>
      </div>
      <div className="screen mt-2 grid max-w-[440px] grid-cols-4 gap-1 p-2">
        {ZONES.map((z, k) => {
          // what the controller knows: its actuator's feedback, which is what it asks on
          const dmp = zo(o, "act", k);
          const req = zo(o, "req", k);
          const counted = zo(o, "importance", k) > 0;
          const rogue = zo(o, "rogue", k) === 1;
          const yAt = (v: number) => BAR_H - (v / 100) * BAR_H;
          return (
            <div key={z.id} className="flex min-w-0 flex-col items-center gap-1.5">
              <span className="num w-full truncate text-center text-[9.5px] uppercase tracking-[0.06em] text-screen-dim" title={z.name}>
                {`${k + 1} ${z.tag}`}
              </span>
              <svg viewBox={`0 0 40 ${BAR_H}`} width="40" height={BAR_H} role="img" aria-label={`${z.name}: damper ${fmt(dmp)} % open, ${req} request${req === 1 ? "" : "s"}${counted ? "" : ", ignored"}`}>
                <rect x="12" y="0" width="16" height={BAR_H} rx="2" fill="var(--screen-line)" opacity=".5" />
                <rect
                  x="12"
                  y={yAt(dmp)}
                  width="16"
                  height={BAR_H - yAt(dmp)}
                  rx="2"
                  fill={rogue ? "var(--fault)" : req > 0 && counted ? "var(--accent)" : "var(--screen-ink)"}
                  opacity={counted ? 0.9 : 0.35}
                />
                <line x1="6" x2="34" y1={yAt(95)} y2={yAt(95)} stroke="var(--accent)" strokeWidth="1" />
                <line x1="6" x2="34" y1={yAt(85)} y2={yAt(85)} stroke="var(--screen-dim)" strokeWidth="1" strokeDasharray="2 2" />
              </svg>
              <span className="num text-[11px] text-screen-ink">{fmt(dmp)}%</span>
              <ReqDots n={req} counted={counted} />
              <button
                type="button"
                className="key !min-h-[26px] !px-2 !text-[10px]"
                data-on={counted}
                aria-pressed={counted}
                title={counted ? "Counting this zone's requests (importance ×1). Tap to ignore it." : "Ignoring this zone (importance ×0). Tap to count it again."}
                onClick={() =>
                  setInputs((i) => ({ ...i, zones: i.zones.map((zz, j) => (j === k ? { ...zz, importance: zz.importance > 0 ? 0 : 1 } : zz)) }))
                }
              >
                ×{counted ? 1 : 0}
              </button>
              <span className="num text-[9px] text-screen-dim" title="Share of the last few minutes this box spent asking (Guideline 36 keeps these as request-hours)">
                {fmt(zo(o, "share", k) * 100)}% asking
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
        Bars are each box&apos;s damper. Past the orange line (95 %) it asks for more pressure and keeps asking until it closes below the dashed one (85 %). Starved of air while wide open, it asks twice or three times. ×1 counts a zone; ×0 ignores it.
      </p>
    </div>
  );
}
