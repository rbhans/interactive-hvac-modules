"use client";

import { useId, useMemo } from "react";
import { fmt } from "@/lab/controls/primitives";
import { oaFraction, type EconInputs, type EconOutputs } from "./model";

const W = 260;
const H = 208;
const P = { l: 30, r: 10, t: 22, b: 26 };
const IW = W - P.l - P.r;
const IH = H - P.t - P.b;
const X = (pos: number) => P.l + (pos / 100) * IW;
const Y = (pct: number) => P.t + IH - (pct / 100) * IH;

function curvePath(authority: number, blade: EconInputs["bladeType"], balance: number) {
  let d = "";
  for (let k = 0; k <= 80; k++) {
    const x = k / 80;
    d += `${k ? "L" : "M"}${X(x * 100).toFixed(1)} ${Y(oaFraction(x, authority, blade, balance) * 100).toFixed(1)}`;
  }
  return d;
}

const BALANCE = [
  { value: 0.7, label: "Weaker", hint: "Long return ductwork, no return fan" },
  { value: 1, label: "Balanced", hint: "Both paths equally easy" },
  { value: 1.4, label: "Stronger", hint: "A return fan pushing into the mixing box" },
];

/**
 * The installed characteristic with the live operating point.
 * The filled dot is where the blades really are. The ring is where the BAS believes they are.
 */
export function CurvePlot({
  inputs,
  outputs,
  setInputs,
}: {
  inputs: EconInputs;
  outputs: EconOutputs;
  setInputs: (fn: (i: EconInputs) => EconInputs) => void;
}) {
  const id = useId();
  const { authority, bladeType, returnBalance } = inputs;
  const other = bladeType === "opposed" ? "parallel" : "opposed";
  const live = useMemo(() => curvePath(authority, bladeType, returnBalance), [authority, bladeType, returnBalance]);
  const ghost = useMemo(() => curvePath(authority, other, returnBalance), [authority, other, returnBalance]);

  const pos = outputs.bladePosPct;
  const pct = outputs.oaPct;
  const fb = outputs.actuatorPosPct;
  const fbPct = oaFraction(fb / 100, authority, bladeType, returnBalance) * 100;
  const disagree = Math.abs(fb - pos) > 3;

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="num text-[28px] leading-none tracking-tight text-ink">
            {fmt(pos)}
            <span className="text-[14px] text-ink-3">%</span>
            <span className="mx-1.5 text-[18px] text-ink-3" aria-hidden>
              →
            </span>
            <span className="text-accent">{fmt(pct)}</span>
            <span className="text-[14px] text-ink-3">%</span>
          </div>
          <div className="micro mt-1.5">Damper open → outside air in the mix</div>
        </div>
      </div>

      <div className="screen mt-3 max-w-[440px] overflow-hidden p-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-labelledby={`${id}-t`}>
          <title id={`${id}-t`}>
            {`Outdoor-air fraction against damper position for linked OA and return dampers, ${bladeType} blades, authority ${authority.toFixed(2)}. Blades at ${fmt(pos)} % deliver ${fmt(pct)} % outdoor air.`}
          </title>
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={X(0)} x2={X(100)} y1={Y(v)} y2={Y(v)} stroke="var(--screen-line)" />
              <line x1={X(v)} x2={X(v)} y1={Y(0)} y2={Y(100)} stroke="var(--screen-line)" />
              <text x={X(0) - 6} y={Y(v) + 3} textAnchor="end" fontSize="8.5" className="num" fill="var(--screen-dim)">
                {v}
              </text>
              <text x={X(v)} y={Y(0) + 12} textAnchor="middle" fontSize="8.5" className="num" fill="var(--screen-dim)">
                {v}
              </text>
            </g>
          ))}
          <text x={X(100)} y={H - 3} textAnchor="end" fontSize="8" className="num" fill="var(--screen-dim)" letterSpacing=".08em">
            DAMPER OPEN %
          </text>
          <text x={4} y={10} fontSize="8" className="num" fill="var(--screen-dim)" letterSpacing=".08em">
            OUTSIDE AIR %
          </text>

          {/* if position were percentage */}
          <line x1={X(0)} y1={Y(0)} x2={X(100)} y2={Y(100)} stroke="var(--screen-dim)" strokeDasharray="3 3" strokeWidth="1" />
          <path d={ghost} fill="none" stroke="var(--screen-dim)" strokeOpacity=".5" strokeWidth="1.25" />
          <path d={live} fill="none" stroke="var(--accent)" strokeWidth="2" />

          {/* crosshair to the axes */}
          <path d={`M${X(pos)} ${Y(0)} V${Y(pct)} H${X(0)}`} fill="none" stroke="var(--screen-ink)" strokeOpacity=".55" strokeDasharray="2 2" />

          {disagree && (
            <g>
              <circle cx={X(fb)} cy={Y(fbPct)} r="5.5" fill="none" stroke="var(--screen-ink)" strokeWidth="1.25" />
              <text x={X(fb) - 8} y={Y(fbPct) + 3} textAnchor="end" fontSize="8" className="num" fill="var(--screen-ink)">
                BAS THINKS
              </text>
            </g>
          )}
          <circle cx={X(pos)} cy={Y(pct)} r="4.5" fill="var(--accent)" stroke="var(--screen)" strokeWidth="1.5" />
          {disagree && (
            <text x={X(pos) + 8} y={Y(pct) + 3} fontSize="8" className="num" fill="var(--accent)">
              ACTUAL
            </text>
          )}
        </svg>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px]">
        <span className="num flex items-center gap-1.5 text-ink-3">
          <span className="inline-block h-[2px] w-3.5 bg-accent" /> {bladeType}
          <span className="ml-2 inline-block h-[1.5px] w-3.5 bg-ink-3/60" /> {other}
        </span>
        <span className="num flex items-center gap-1.5 text-ink-3">
          <svg width="14" height="4" aria-hidden>
            <line x1="0" y1="2" x2="14" y2="2" stroke="currentColor" strokeDasharray="3 2" />
          </svg>
          if position were %
        </span>
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3">
        <span className="micro">Blades</span>
        <div role="radiogroup" aria-label="Blade type" className="flex gap-1.5">
          {(["opposed", "parallel"] as const).map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={bladeType === b}
              data-on={bladeType === b}
              className="key flex-1 !min-h-[28px] !px-2 !text-[10px]"
              onClick={() => setInputs((i) => ({ ...i, bladeType: b }))}
            >
              {b}
            </button>
          ))}
        </div>
        <label htmlFor={`${id}-a`} className="micro">
          Authority
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${id}-a`}
            type="range"
            className="fader min-w-0 flex-1"
            min={0}
            max={1}
            step={0.005}
            // log-ish mapping so the interesting 2–15 % range gets most of the travel
            value={Math.log(authority / 0.02) / Math.log(1 / 0.02)}
            onChange={(e) => {
              const a = 0.02 * Math.pow(1 / 0.02, Number(e.target.value));
              setInputs((i) => ({ ...i, authority: Math.round(a * 1000) / 1000 }));
            }}
            aria-valuetext={`authority ${(authority * 100).toFixed(0)} percent`}
          />
          <span className="num w-10 text-right text-[13px] text-ink">{(authority * 100).toFixed(0)}%</span>
        </div>
        <span className="micro" id={`${id}-b`}>
          Return
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-b`} className="flex gap-1.5">
          {BALANCE.map((b) => (
            <button
              key={b.value}
              type="button"
              role="radio"
              aria-checked={returnBalance === b.value}
              data-on={returnBalance === b.value}
              title={b.hint}
              className="key flex-1 !min-h-[28px] !px-1.5 !text-[10px]"
              onClick={() => setInputs((i) => ({ ...i, returnBalance: b.value }))}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
        Return: {(BALANCE.find((b) => b.value === returnBalance)?.hint ?? "custom balance").toLowerCase()}. Authority: how much of
        each path&rsquo;s resistance is the damper itself. The return damper closes as the outside damper opens, so both set the mix.
      </p>
    </div>
  );
}
