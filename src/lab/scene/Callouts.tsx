"use client";

import { Html } from "@react-three/drei";
import { cn } from "@/lib/utils";
import { HandIcon } from "../controls/primitives";
import { RuntimeContext, useRuntime, useRuntimeStore } from "../shell/runtime";
import type { Callout, Outputs } from "../types";
import type * as THREE from "three";

const TONE_DOT: Record<string, string> = {
  neutral: "bg-screen-ink",
  cold: "bg-cold",
  warm: "bg-warm",
  fault: "bg-fault",
  overridden: "bg-hand",
};

function Chip({ c }: { c: Callout<Outputs> }) {
  const value = useRuntime((s) => c.value(s.outputs));
  const tone = useRuntime((s) => c.tone?.(s.outputs) ?? "neutral");
  const hand = useRuntime((s) => c.hand?.(s.outputs) ?? false);
  const hidden = useRuntime((s) => !s.view.labels || s.view.exploded || (c.when ? !c.when(s.outputs) : false));
  return (
    <div
      className={cn(
        "num pointer-events-none flex -translate-y-1/2 select-none items-center gap-1.5 whitespace-nowrap rounded-[5px] py-[3px] pl-1.5 pr-2 text-[10px] leading-none tracking-[0.04em] shadow-[0_4px_14px_-6px_rgba(0,0,0,.8)] transition-opacity duration-200",
        tone === "overridden" ? "bg-hand text-white" : tone === "fault" ? "bg-fault text-black" : "bg-white/92 text-[#111113] ring-1 ring-black/[.06]",
        hidden && "opacity-0",
      )}
      aria-hidden
    >
      {hand ? (
        <HandIcon className="size-3" />
      ) : (
        <span className={cn("size-1.5 rounded-full", tone === "fault" || tone === "overridden" ? "bg-current" : TONE_DOT[tone])} />
      )}
      <span className="opacity-60">{c.label}</span>
      <span>{value}</span>
    </div>
  );
}

export function Callouts({ anchors, callouts }: { anchors: Record<string, THREE.Vector3>; callouts: Callout<Outputs>[] }) {
  // <Html> renders into its own React root, so the store has to be handed across
  const store = useRuntimeStore();
  return (
    <>
      {callouts.map((c) =>
        anchors[c.anchor] ? (
          <Html key={c.anchor} position={anchors[c.anchor]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
            <RuntimeContext.Provider value={store}>
              <Chip c={c} />
            </RuntimeContext.Provider>
          </Html>
        ) : null,
      )}
    </>
  );
}
