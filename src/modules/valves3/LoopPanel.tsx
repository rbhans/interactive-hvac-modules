"use client";

import { fmt } from "@/lab/controls/primitives";
import { heatCss } from "@/lab/heat";
import { COIL, DESIGN_FLOW, LOOP, co, type ValveInputs, type ValveOutputs } from "./model";

const BAR_MAX = 130; // gpm across a coil's bar

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

/**
 * The module's instrument: where each coil's water goes (through the coil, or around it), what that does
 * to the loop's flow and the pump, and how warm the water goes back to the chiller.
 */
export function LoopPanel({
  outputs: o,
  setInputs,
}: {
  inputs: ValveInputs;
  outputs: ValveOutputs;
  setInputs: (fn: (i: ValveInputs) => ValveInputs) => void;
}) {
  const share = (q: number) => `${(Math.min(BAR_MAX, Math.max(0, q)) / BAR_MAX) * 100}%`;
  const loopPct = (q: number) => `${(Math.min(400, Math.max(0, q)) / 400) * 100}%`;
  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Stat value={fmt(o.total)} unit="gpm" label="Loop flow" />
        <Stat value={o.kw.toFixed(2)} unit="kW" label={`Pump · ${fmt(o.hz)} Hz`} accent />
        <Stat value={o.deltaT.toFixed(1)} unit="°F" label="Return over supply" />
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="micro">Where each coil&apos;s water goes</span>
        <span className="num text-[11px] text-ink-3">{`${fmt(o.load)}% load · ${fmt(o.tons)} tons`}</span>
      </div>
      <div className="screen mt-2 max-w-[440px] space-y-2.5 p-3">
        {[0, 1, 2].map((k) => {
          const three = co(o, "three", k) === 1;
          const coilQ = co(o, "coilQ", k);
          const byp = co(o, "bypassQ", k);
          const lwt = co(o, "lwt", k);
          return (
            <div key={k}>
              <div className="flex items-center justify-between gap-2">
                <span className="num text-[10px] uppercase tracking-[0.08em] text-screen-dim">
                  {`AHU-${k + 1} · valve ${fmt(co(o, "valve", k))}%`}
                </span>
                <button
                  type="button"
                  className="key !min-h-[24px] !px-2 !text-[9.5px]"
                  data-on={three}
                  aria-pressed={three}
                  title={three ? "Three-way, with its bypass. Tap to convert it to a two-way." : "Two-way, no bypass. Tap to make it a three-way again."}
                  onClick={() => setInputs((i) => ({ ...i, kinds: i.kinds.map((v, j) => (j === k ? (v === "three" ? "two" : "three") : v)) }))}
                >
                  {three ? "3-way" : "2-way"}
                </button>
              </div>
              <div className="relative mt-1.5 h-[14px] overflow-hidden rounded-[3px] bg-white/[.06]" role="img" aria-label={`Coil ${k + 1}: ${fmt(coilQ)} gpm through the coil, ${fmt(byp)} gpm around it`}>
                <div className="absolute inset-y-0 left-0" style={{ width: share(coilQ), background: heatCss(lwt) }} />
                <div
                  className="absolute inset-y-0"
                  style={{
                    left: share(coilQ),
                    width: share(byp),
                    background: `repeating-linear-gradient(135deg, ${heatCss(COIL.supply, 0.85)} 0 4px, ${heatCss(COIL.supply, 0.4)} 4px 8px)`,
                  }}
                />
                <div className="absolute inset-y-0 w-px bg-white/40" style={{ left: share(COIL.flow) }} />
              </div>
              <div className="num mt-1 flex justify-between text-[10px] text-screen-dim">
                <span>
                  <span className="text-screen-ink">{fmt(coilQ)}</span> gpm · out {lwt.toFixed(0)}°F
                </span>
                <span>{three ? <><span className="text-screen-ink">{fmt(byp)}</span> around</> : "no bypass"}</span>
              </div>
            </div>
          );
        })}
        <div className="border-t border-screen-line pt-2.5">
          <div className="num flex justify-between text-[10px] uppercase tracking-[0.08em] text-screen-dim">
            <span>Loop · back at {o.returnT.toFixed(1)}°F</span>
            <span className={o.lowFlow ? "text-alarm" : ""}>{o.lowFlow ? "too little for the chiller" : `design ${DESIGN_FLOW}`}</span>
          </div>
          <div className="relative mt-1.5 h-[14px] overflow-hidden rounded-[3px] bg-white/[.06]" role="img" aria-label={`Loop flow ${fmt(o.total)} gpm; the chiller needs at least ${LOOP.chillerMin}`}>
            <div className="absolute inset-y-0 left-0" style={{ width: loopPct(o.total), background: heatCss(o.returnT) }} />
            <div className="absolute inset-y-0 w-[2px] bg-alarm" style={{ left: loopPct(LOOP.chillerMin) }} title="the chiller's minimum flow" />
            <div className="absolute inset-y-0 w-px bg-white/40" style={{ left: loopPct(DESIGN_FLOW) }} />
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
        Solid is water through the coil, colored by how warm it leaves; striped is water sent around it, still cold. Tick marks are design flow; the red mark is
        the least the chiller will run on. Tap 3-way / 2-way to switch a coil&apos;s valve.
      </p>
    </div>
  );
}
