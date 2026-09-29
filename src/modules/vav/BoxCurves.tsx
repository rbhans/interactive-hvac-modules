"use client";

import { useId, useMemo } from "react";
import { fmt } from "@/lab/controls/primitives";
import { boxFlow, flowFromVp, velocityPressure, type VavInputs, type VavOutputs } from "./model";

const W = 260;
const H = 172;
const P = { l: 34, r: 10, t: 20, b: 24 };
const IW = W - P.l - P.r;
const IH = H - P.t - P.b;

/** A good transducer's zero drift, in. w.c.: the everyday error the bottom chart is drawn for */
const GOOD_DRIFT = 0.005;

function Axes({ xTicks, yTicks, x, y, xLabel, yLabel }: { xTicks: number[]; yTicks: number[]; x: (v: number) => number; y: (v: number) => number; xLabel: string; yLabel: string }) {
  return (
    <>
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line x1={P.l} x2={P.l + IW} y1={y(v)} y2={y(v)} stroke="var(--screen-line)" />
          <text x={P.l - 6} y={y(v) + 3} textAnchor="end" fontSize="8.5" className="num" fill="var(--screen-dim)">
            {v}
          </text>
        </g>
      ))}
      {xTicks.map((v) => (
        <g key={`x${v}`}>
          <line x1={x(v)} x2={x(v)} y1={P.t} y2={P.t + IH} stroke="var(--screen-line)" />
          <text x={x(v)} y={P.t + IH + 11} textAnchor="middle" fontSize="8.5" className="num" fill="var(--screen-dim)">
            {v}
          </text>
        </g>
      ))}
      <text x={P.l + IW} y={H - 3} textAnchor="end" fontSize="8" className="num" fill="var(--screen-dim)" letterSpacing=".08em">
        {xLabel}
      </text>
      <text x={4} y={10} fontSize="8" className="num" fill="var(--screen-dim)" letterSpacing=".08em">
        {yLabel}
      </text>
    </>
  );
}

const line = (pts: [number, number][]) => pts.map(([a, b], k) => `${k ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join("");

/**
 * The VAV module's instruments: what the damper can deliver at the duct pressure it's getting, and
 * how much the airflow reading can be trusted at each airflow.
 */
export function BoxCurves({ inputs, outputs }: { inputs: VavInputs; outputs: VavOutputs; setInputs: (fn: (i: VavInputs) => VavInputs) => void }) {
  const id = useId();
  const staticNow = outputs.staticIn;

  // ── damper curve at this static ──
  const qTop = 1200;
  const xd = (pct: number) => P.l + (pct / 100) * IW;
  const yd = (q: number) => P.t + IH - (Math.min(qTop, Math.max(0, q)) / qTop) * IH;
  const staticKey = Math.round(staticNow * 50);
  const damperPath = useMemo(() => {
    const pts: [number, number][] = [];
    for (let k = 0; k <= 60; k++) {
      const pct = (k / 60) * 100;
      pts.push([xd(pct), yd(boxFlow(pct / 100, staticKey / 50))]);
    }
    return line(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticKey]);
  const measured = outputs.independent === 1;
  const short = measured && outputs.qMaxAvail < outputs.flowSp * 0.98;

  // ── how far a small transducer drift throws the reading ──
  const qMax = 1000;
  const errTop = 60;
  const xe = (q: number) => P.l + (q / qMax) * IW;
  const ye = (e: number) => P.t + IH - (Math.min(errTop, Math.max(0, e)) / errTop) * IH;
  const errAt = (q: number, drift: number) => (flowFromVp(velocityPressure(q) + drift) / q - 1) * 100;
  const goodPath = useMemo(() => {
    const pts: [number, number][] = [];
    for (let k = 1; k <= 60; k++) {
      const q = 40 + (k / 60) * (qMax - 40);
      pts.push([xe(q), ye(errAt(q, GOOD_DRIFT))]);
    }
    return line(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const drift = inputs.faults.vpOffset;
  const driftPath = useMemo(() => {
    if (Math.abs(drift) < 1e-4) return null;
    const pts: [number, number][] = [];
    for (let k = 1; k <= 60; k++) {
      const q = 40 + (k / 60) * (qMax - 40);
      pts.push([xe(q), ye(Math.abs(errAt(q, drift)))]);
    }
    return line(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drift]);
  const atMin = errAt(inputs.minFlow, GOOD_DRIFT);
  const nowErr = Math.abs(outputs.readErrPct);

  return (
    <div>
      <div className="num text-[28px] leading-none tracking-tight text-ink">
        {fmt(outputs.q)}
        <span className="text-[14px] text-ink-3"> cfm</span>
        <span className="mx-1.5 text-[18px] text-ink-3" aria-hidden>
          /
        </span>
        {measured ? (
          <>
            <span className={short ? "text-fault" : "text-accent"}>{fmt(outputs.flowSp)}</span>
            <span className="text-[14px] text-ink-3"> wanted</span>
          </>
        ) : (
          <span className="text-[14px] text-ink-3">no airflow sensor</span>
        )}
      </div>
      <div className="micro mt-1.5">
        {measured ? "Airflow really moving / what the room is asking for" : "Airflow really moving: the thermostat only sets the damper"} ·{" "}
        {staticNow.toFixed(2)} in. of duct pressure here
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="micro">What the damper can deliver here</span>
        <span className="num text-[11px] text-ink-3">{short ? "wide open and still short" : `${fmt(outputs.bladePct)}% open`}</span>
      </div>
      <div className="screen mt-2 max-w-[440px] overflow-hidden p-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-labelledby={`${id}-a`}>
          <title id={`${id}-a`}>{`At ${staticNow.toFixed(2)} in. of duct pressure the box can deliver up to ${fmt(outputs.qMaxAvail)} cfm wide open.${measured ? ` The room wants ${fmt(outputs.flowSp)} cfm;` : ""} The damper is ${fmt(outputs.bladePct)} % open.`}</title>
          <Axes xTicks={[0, 25, 50, 75, 100]} yTicks={[0, 300, 600, 900, 1200]} x={xd} y={yd} xLabel="DAMPER OPEN %" yLabel="CFM" />
          {short && <rect x={P.l} y={yd(outputs.flowSp)} width={IW} height={Math.max(0, yd(outputs.qMaxAvail) - yd(outputs.flowSp))} fill="var(--fault)" opacity=".16" />}
          {measured && <line x1={P.l} x2={P.l + IW} y1={yd(outputs.flowSp)} y2={yd(outputs.flowSp)} stroke="var(--screen-ink)" strokeOpacity=".7" strokeDasharray="3 3" />}
          <path d={damperPath} fill="none" stroke="var(--accent)" strokeWidth="2" />
          <circle cx={xd(outputs.bladePct)} cy={yd(outputs.q)} r="4.5" fill="var(--accent)" stroke="var(--screen)" strokeWidth="1.5" />
        </svg>
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
        The dashed line is the airflow the room is asking for. More duct pressure makes the curve steeper, so the damper does its work in less of its travel. Too little, and even wide open falls short.
      </p>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="micro">How far off the airflow reading can be</span>
        <span className="num text-[11px] text-ink-3">{measured ? `off by ${fmt(nowErr)}% right now` : "this box doesn't measure it"}</span>
      </div>
      <div className="screen mt-2 max-w-[440px] overflow-hidden p-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-labelledby={`${id}-b`}>
          <title id={`${id}-b`}>{`A transducer drift of just 0.005 in. of water throws the airflow reading off by ${fmt(atMin)} % at the ${fmt(inputs.minFlow)} cfm minimum, and under 1 % at full flow. The reading is off by ${fmt(nowErr)} % right now.`}</title>
          <Axes xTicks={[0, 250, 500, 750, 1000]} yTicks={[0, 20, 40, 60]} x={xe} y={ye} xLabel="AIRFLOW CFM" yLabel="READING OFF %" />
          <line x1={xe(inputs.minFlow)} x2={xe(inputs.minFlow)} y1={P.t} y2={P.t + IH} stroke="var(--screen-ink)" strokeOpacity=".55" strokeDasharray="2 2" />
          <text x={xe(inputs.minFlow) + 4} y={P.t + 9} fontSize="8" className="num" fill="var(--screen-dim)">
            MIN
          </text>
          <path d={goodPath} fill="none" stroke="#27b7ff" strokeWidth="1.5" strokeDasharray="4 3" />
          {driftPath && <path d={driftPath} fill="none" stroke="var(--accent)" strokeWidth="2" />}
          {measured && <circle cx={xe(Math.min(qMax, outputs.q))} cy={ye(nowErr)} r="4.5" fill="var(--accent)" stroke="var(--screen)" strokeWidth="1.5" />}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
        <span className="num flex items-center gap-1.5 text-ink-3">
          <svg width="14" height="4" aria-hidden>
            <line x1="0" y1="2" x2="14" y2="2" stroke="#27b7ff" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          a good transducer, drifted 0.005 in.
        </span>
        {driftPath && (
          <span className="num flex items-center gap-1.5 text-ink-3">
            <span className="inline-block h-[2px] w-3.5 bg-accent" /> this one, {drift > 0 ? "+" : ""}
            {drift.toFixed(3)} in.
          </span>
        )}
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
        The box measures airflow as a pressure that grows with the square of the airflow. Halve the air and the signal drops to a quarter, so at minimum a hair of sensor drift is a big share of the reading.
      </p>
    </div>
  );
}
