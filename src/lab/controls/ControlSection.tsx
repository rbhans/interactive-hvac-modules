"use client";

import { useShallow } from "zustand/react/shallow";
import { useRuntime } from "../shell/runtime";
import type { Control, ControlSection as Spec, FaultsControl, Outputs, ReadoutControl } from "../types";
import { Fader } from "./Fader";
import { FaultDrawer, FaultSwitch } from "./FaultDrawer";
import { Knob } from "./Knob";
import { Override } from "./Override";
import { PointReadout } from "./PointReadout";
import { Section } from "./primitives";
import { SetpointField } from "./SetpointField";
import { TrendChart } from "./TrendChart";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type C = Control<any, Outputs>;

function useIO() {
  return useRuntime(useShallow((s) => ({ inputs: s.inputs, outputs: s.outputs, setInputs: s.setInputs })));
}

function Segmented({ c }: { c: Extract<C, { kind: "segmented" }> }) {
  const { inputs, setInputs } = useIO();
  const value = c.get(inputs);
  return (
    <div>
      <div className="micro mb-1.5">{c.label}</div>
      <div role="radiogroup" aria-label={c.label} className="flex gap-1.5">
        {c.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            data-on={value === o.value}
            className="key flex-1 !min-h-[30px] !px-2 !text-[10px]"
            onClick={() => setInputs((i) => c.set(i, o.value))}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Readouts({ items }: { items: ReadoutControl<Outputs>[] }) {
  const outputs = useRuntime((s) => s.outputs);
  const bas = items.filter((r) => !r.reality);
  const real = items.filter((r) => r.reality);
  const row = (r: ReadoutControl<Outputs>) => (
    <PointReadout
      key={r.id}
      point={r.point}
      label={r.label}
      unit={r.unit}
      digits={r.digits}
      value={r.value(outputs)}
      status={r.status?.(outputs)}
      pair={r.pair && { label: r.pair.label, value: r.pair.value(outputs) }}
      reality={r.reality}
    />
  );
  return (
    <div className="grid gap-x-6 gap-y-3 @lg:grid-cols-2" aria-live="off">
      <div>
        <div className="micro mb-0.5 flex items-center gap-1.5 !text-ink-2">The control system reads</div>
        <div className="divide-y divide-line">{bas.map(row)}</div>
      </div>
      {real.length > 0 && (
        <div className="relative rounded-[10px] border border-dashed border-line-2 px-3 pb-1 pt-2">
          <div className="micro mb-0.5 flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
              <path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="8" cy="8" r="2" fill="currentColor" />
            </svg>
            Reality · the control system can’t see this
          </div>
          <div className="divide-y divide-dashed divide-line">{real.map(row)}</div>
        </div>
      )}
    </div>
  );
}

function Faults({ c }: { c: FaultsControl<unknown> }) {
  const { inputs, outputs, setInputs } = useIO();
  return (
    <FaultDrawer active={c.active(inputs)}>
      {c.items.map((f) =>
        f.kind === "toggle" ? (
          <FaultSwitch
            key={f.id}
            label={f.label}
            hint={f.hint}
            on={f.get(inputs)}
            onChange={(on) => setInputs((i) => f.set(i, on, f.capture ? outputs[f.capture] : 0))}
          />
        ) : (
          <Fader
            key={f.id}
            label={f.label}
            hint={f.hint}
            unit={f.unit}
            min={f.min}
            max={f.max}
            step={f.step}
            digits={f.step < 1 ? 1 : 0}
            value={f.get(inputs)}
            onChange={(v) => setInputs((i) => f.set(i, v))}
            marks={[{ label: "0", value: 0 }]}
          />
        ),
      )}
    </FaultDrawer>
  );
}

function Trend({ c }: { c: Extract<C, { kind: "trend" }> }) {
  const { trend, now } = useRuntime(useShallow((s) => ({ trend: s.trend, now: s.state.t as number })));
  return <TrendChart pens={c.pens} window={c.window} t={trend.t} series={trend.series} now={now} left={c.left} />;
}

function Single({ c }: { c: C }) {
  const { inputs, outputs, setInputs } = useIO();
  const preset = useRuntime((s) => s.mod.presets.find((p) => p.id === s.presetId));
  switch (c.kind) {
    case "slider":
      return (
        <Fader
          label={c.label}
          unit={c.unit}
          min={c.min}
          max={c.max}
          step={c.step}
          digits={c.step < 1 ? 1 : 0}
          hint={c.hint}
          value={c.get(inputs)}
          marks={c.marks?.(inputs, outputs)}
          onChange={(v) => setInputs((i) => c.set(i, v))}
        />
      );
    case "setpoint":
      return (
        <SetpointField
          label={c.label}
          point={c.point}
          unit={c.unit}
          min={c.min}
          max={c.max}
          step={c.step}
          digits={c.digits}
          value={c.get(inputs)}
          onChange={(v) => setInputs((i) => c.set(i, v))}
        />
      );
    case "knob":
      return (
        <Knob
          label={c.label}
          unit={c.unit}
          min={c.min}
          max={c.max}
          step={c.step}
          digits={c.digits}
          color={c.color}
          warnAbove={c.warnAbove}
          hint={c.hint}
          value={c.get(inputs)}
          resetTo={preset ? c.get(preset.inputs) : undefined}
          onChange={(v) => setInputs((i) => c.set(i, v))}
        />
      );
    case "segmented":
      return <Segmented c={c} />;
    case "override": {
      const v = c.get(inputs);
      return (
        <Override
          label={c.label}
          point={c.point}
          unit={c.unit}
          min={c.min}
          max={c.max}
          step={c.step}
          mode={v.mode}
          value={v.value}
          programValue={c.programValue(outputs)}
          programPriority={c.programPriority}
          activePriority={c.activePriority(outputs)}
          otherSlots={c.otherSlots?.(outputs)}
          onChange={(nv) => setInputs((i) => c.set(i, nv))}
        />
      );
    }
    case "trend":
      return <Trend c={c} />;
    case "faults":
      return <Faults c={c as FaultsControl<unknown>} />;
    case "custom":
      return <c.Component inputs={inputs} outputs={outputs} setInputs={setInputs} />;
    case "readout":
      return <Readouts items={[c]} />;
  }
}

/** Group consecutive controls of the same kind so they lay out as rows. */
function groups(controls: C[]) {
  const out: { kind: C["kind"]; items: C[] }[] = [];
  for (const c of controls) {
    const g = out[out.length - 1];
    if (g && g.kind === c.kind && ["setpoint", "knob", "readout", "slider"].includes(c.kind)) g.items.push(c);
    else out.push({ kind: c.kind, items: [c] });
  }
  return out;
}

export function ControlSectionView({ spec, index, className }: { spec: Spec<unknown, Outputs>; index: string; className?: string }) {
  const { inputs, outputs } = useIO();
  const visible = (spec.controls as C[]).filter((c) => !c.when || c.when(inputs, outputs));
  return (
    <Section index={index} title={spec.title} className={className}>
      {spec.description && <p className="-mt-1 mb-4 text-[12.5px] leading-snug text-ink-3">{spec.description}</p>}
      <div className="space-y-5">
        {groups(visible).map((g, k) => {
          if (g.kind === "readout") return <Readouts key={k} items={g.items as ReadoutControl<Outputs>[]} />;
          if (g.kind === "setpoint")
            return (
              <div key={k} className="space-y-3">
                {g.items.map((c) => (
                  <Single key={c.id} c={c} />
                ))}
              </div>
            );
          if (g.kind === "knob")
            return (
              <div key={k} className="flex justify-around gap-4">
                {g.items.map((c) => (
                  <Single key={c.id} c={c} />
                ))}
              </div>
            );
          return (
            <div key={k} className="space-y-5">
              {g.items.map((c) => (
                <Single key={c.id} c={c} />
              ))}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
