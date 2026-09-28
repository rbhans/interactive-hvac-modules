"use client";

import Link from "next/link";
import { useShallow } from "zustand/react/shallow";
import { ControlSectionView } from "../controls/ControlSection";
import { PointReadout } from "../controls/PointReadout";
import type { Outputs, ReadoutControl } from "../types";
import { Display } from "./Display";
import { ModuleHost } from "./ModuleHost";
import { PresetsBar } from "./PresetsBar";
import { useRuntime } from "./runtime";

/** The live readouts own the per-tick `outputs` subscription, so the rest of the embed (and its 3D view) doesn't re-render every tick. */
function EmbedReadouts() {
  const readouts = useRuntime(
    useShallow((s) =>
      s.mod.controls
        .flatMap((c) => c.controls)
        .filter((c): c is ReadoutControl<Outputs> => c.kind === "readout" && !c.reality)
        .slice(0, 3),
    ),
  );
  const outputs = useRuntime((s) => s.outputs);
  return (
    <div className="mt-3 grid grid-cols-3 gap-x-4 border-b border-line pb-2">
      {readouts.map((r) => (
        <PointReadout
          key={r.id}
          point={r.point.split("/").pop()!}
          label={r.label}
          unit={r.unit}
          digits={r.digits}
          value={r.value(outputs)}
          status={r.status?.(outputs)}
          pair={r.pair && { label: r.pair.label, value: r.pair.value(outputs) }}
        />
      ))}
    </div>
  );
}

function EmbedBody({ controls }: { controls?: string[] }) {
  const mod = useRuntime((s) => s.mod);
  const presetId = useRuntime((s) => s.presetId);
  const extra = mod.controls.filter((c) => controls?.includes(c.id));

  return (
    <div className="chassis-panel not-prose my-8 overflow-hidden p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="micro !text-ink">
          <span className="mr-2 text-accent">{mod.number}</span>
          {mod.title}
        </span>
        <Link href={presetId ? `/lab/${mod.slug}?preset=${encodeURIComponent(presetId)}` : `/lab/${mod.slug}`} className="micro hover:!text-ink">
          Open full module →
        </Link>
      </div>
      <Display compact className="aspect-[16/10] w-full" />
      <EmbedReadouts />
      {extra.map((s, k) => (
        <ControlSectionView key={s.id} spec={s} index={String.fromCharCode(65 + k)} className="px-0" />
      ))}
      <div className="mt-3">
        <PresetsBar compact />
      </div>
    </div>
  );
}

/**
 * Drop a module into an MDX lesson: `<LabEmbed slug="economizer" preset="stuck" />`.
 * `controls` pulls in extra control sections by id.
 */
export function LabEmbed({ slug, preset, controls }: { slug: string; preset?: string; controls?: string[] }) {
  return (
    <ModuleHost
      slug={slug}
      preset={preset}
      fallback={<div className="chassis-panel my-8 p-4"><div className="screen aspect-[16/10]" /></div>}
    >
      <EmbedBody controls={controls} />
    </ModuleHost>
  );
}
