"use client";

import { useId, useMemo } from "react";
import { fmt } from "@/lab/controls/primitives";
import { DESIGN, pipesK, pumpHead, systemK, type PumpInputs, type PumpOutputs } from "./model";

const W = 260;
const H = 196;
const P = { l: 30, r: 10, t: 18, b: 24 };
const IW = W - P.l - P.r;
const IH = H - P.t - P.b;
const Q_MAX = 1000;
const H_MAX = 130;
const X = (q: number) => P.l + (Math.min(Q_MAX, Math.max(0, q)) / Q_MAX) * IW;
const Y = (h: number) => P.t + IH - (Math.min(H_MAX, Math.max(0, h)) / H_MAX) * IH;

function curve(f: (q: number) => number, qTo = Q_MAX) {
  let d = "";
  for (let k = 0; k <= 60; k++) {
    const q = (k / 60) * qTo;
    const h = f(q);
    if (h < 0) break;
    d += `${d ? "L" : "M"}${X(q).toFixed(1)} ${Y(h).toFixed(1)}`;
    // off the top of the chart: stop there instead of running along the edge
    if (h > H_MAX) break;
  }
  return d;
}

/**
 * The module's instrument: where the pump's curve meets the system's. Slowing the pump drops its whole
 * curve; closing the valve steepens the system's. The orange bar is the head the valve throws away.
 */
export function PumpCurves({ inputs, outputs: o }: { inputs: PumpInputs; outputs: PumpOutputs; setInputs: (fn: (i: PumpInputs) => PumpInputs) => void }) {
  const id = useId();
  const n = o.speedPct / 100;
  const x = o.valvePct / 100;
  // quantize so the curves don't rebuild on every tick
  const key = `${inputs.size}|${inputs.faults.reversed}|${Math.round(inputs.faults.clog * 50)}|${Math.round(n * 200)}|${Math.round(x * 200)}`;
  const paths = useMemo(() => {
    const pumpFull = curve((q) => pumpHead(q, 1, inputs));
    const pumpNow = curve((q) => pumpHead(q, n, inputs));
    const kOpen = pipesK(inputs);
    const kNow = systemK(x, inputs);
    const sysOpen = curve((q) => kOpen * q * q);
    const sysNow = curve((q) => kNow * q * q);
    return { pumpFull, pumpNow, sysOpen, sysNow, kOpen };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const q = o.q;
  const hOp = o.head;
  const hPipes = paths.kOpen * q * q;
  // what's left over the pipes' own curve is what the valve takes
  const burned = Math.max(0, hOp - hPipes);
  const slowed = n < 0.995;
  const pct = (v: number) => `${fmt(v * 100)}%`;

  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <div>
          <div className="num text-[26px] leading-none tracking-tight text-ink">
            {fmt(q)}
            <span className="text-[13px] text-ink-3"> gpm</span>
          </div>
          <div className="micro mt-1">Flow · wanted {fmt(o.flowSp)}</div>
        </div>
        <div>
          <div className="num text-[26px] leading-none tracking-tight text-accent">
            {o.kw.toFixed(2)}
            <span className="text-[13px] text-ink-3"> kW</span>
          </div>
          <div className="micro mt-1">Pump power</div>
        </div>
        <div>
          <div className="num text-[26px] leading-none tracking-tight text-ink">
            {o.kwOther.toFixed(2)}
            <span className="text-[13px] text-ink-3"> kW</span>
          </div>
          <div className="micro mt-1">{o.vfd ? "Same flow, throttled" : "Same flow, slowed"}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="micro">Pump curve meets system curve</span>
        <span className="num text-[11px] text-ink-3">{`${fmt(o.hz)} Hz · valve ${fmt(o.valvePct)}% · ${fmt(o.eff * 100)}% efficient`}</span>
      </div>
      <div className="screen mt-2 max-w-[440px] overflow-hidden p-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-labelledby={`${id}-t`}>
          <title id={`${id}-t`}>
            {`The pump runs where its curve meets the system's: ${fmt(q)} gpm at ${fmt(hOp)} ft of head, ${fmt(o.hz)} Hz, the valve ${fmt(o.valvePct)} % open. The valve burns ${fmt(burned)} ft. ${o.kw.toFixed(2)} kW; the other way would take ${o.kwOther.toFixed(2)} kW.`}
          </title>
          {[0, 250, 500, 750, 1000].map((v) => (
            <g key={`x${v}`}>
              <line x1={X(v)} x2={X(v)} y1={P.t} y2={P.t + IH} stroke="var(--screen-line)" />
              <text x={X(v)} y={P.t + IH + 11} textAnchor="middle" fontSize="8.5" className="num" fill="var(--screen-dim)">
                {v}
              </text>
            </g>
          ))}
          {[0, 40, 80, 120].map((v) => (
            <g key={`y${v}`}>
              <line x1={P.l} x2={P.l + IW} y1={Y(v)} y2={Y(v)} stroke="var(--screen-line)" />
              <text x={P.l - 6} y={Y(v) + 3} textAnchor="end" fontSize="8.5" className="num" fill="var(--screen-dim)">
                {v}
              </text>
            </g>
          ))}
          <text x={P.l + IW} y={H - 3} textAnchor="end" fontSize="8" className="num" fill="var(--screen-dim)" letterSpacing=".08em">
            FLOW GPM
          </text>
          <text x={4} y={10} fontSize="8" className="num" fill="var(--screen-dim)" letterSpacing=".08em">
            HEAD FT
          </text>
          {/* design point */}
          <path d={`M${X(DESIGN.flow) - 3} ${Y(DESIGN.head)}h6M${X(DESIGN.flow)} ${Y(DESIGN.head) - 3}v6`} stroke="var(--screen-dim)" strokeWidth="1.2" />
          {/* the pipes alone, and the pump at full speed, as references */}
          <path d={paths.sysOpen} fill="none" stroke="var(--screen-ink)" strokeOpacity=".45" strokeDasharray="3 3" />
          {slowed && <path d={paths.pumpFull} fill="none" stroke="var(--accent)" strokeOpacity=".45" strokeDasharray="3 3" />}
          {/* now */}
          <path d={paths.sysNow} fill="none" stroke="var(--screen-ink)" strokeWidth="1.5" />
          <path d={paths.pumpNow} fill="none" stroke="var(--accent)" strokeWidth="2" />
          {/* the head the valve throws away */}
          {burned > 1 && <line x1={X(q)} x2={X(q)} y1={Y(hPipes)} y2={Y(hOp)} stroke="var(--fault)" strokeWidth="4" strokeLinecap="round" opacity=".85" />}
          <circle cx={X(q)} cy={Y(hOp)} r="4.5" fill="var(--accent)" stroke="var(--screen)" strokeWidth="1.5" />
          {/* best efficiency at this speed */}
          <path d={`M${X(o.bepNow)} ${Y(pumpHead(o.bepNow, n, inputs)) - 6}l3 -5h-6z`} fill="var(--ok)" />
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
        <span className="num flex items-center gap-1.5 text-ink-3">
          <span className="inline-block h-[2px] w-3.5 bg-accent" /> pump {slowed ? `at ${fmt(o.hz)} Hz` : ""}
        </span>
        <span className="num flex items-center gap-1.5 text-ink-3">
          <svg width="14" height="4" aria-hidden>
            <line x1="0" y1="2" x2="14" y2="2" stroke="var(--screen-ink)" strokeOpacity=".6" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>
          the pipes alone
        </span>
        <span className="num flex items-center gap-1.5 text-ink-3">
          <span className="inline-block h-[1.5px] w-3.5 bg-screen-ink" /> pipes and valve
        </span>
        {burned > 1 && (
          <span className="num flex items-center gap-1.5 text-ink-3">
            <span className="inline-block h-[4px] w-3.5 rounded bg-fault" /> burned in the valve: {fmt(burned)} ft
          </span>
        )}
        <span className="num flex items-center gap-1.5 text-ink-3">
          <span className="inline-block size-0 border-x-[3px] border-b-[5px] border-x-transparent border-b-ok" /> best efficiency
        </span>
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
        {slowed
          ? `At ${pct(n)} speed the pump makes ${pct(n)} of its flow, ${pct(n * n)} of its head and needs about ${pct(n * n * n)} of the power. The water only needs the pressure the pipes take.`
          : x < 0.995
            ? "At full speed the pump rides up its curve as the valve closes. Less flow, more head, and the extra head is burned in the valve."
            : "Full speed, valve wide open: the pump runs where its curve crosses the pipes'."}
      </p>
    </div>
  );
}
