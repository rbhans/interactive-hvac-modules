"use client";

import { useEffect, useRef } from "react";
import type { OverrideControl, Outputs } from "../types";
import type { RuntimeStore } from "./runtime";

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["1", "…", "6"], label: "Load preset" },
  { keys: ["Space"], label: "Run / pause" },
  { keys: ["[", "]"], label: "Slower / faster" },
  { keys: ["M"], label: "Toggle auto / manual" },
  { keys: ["C"], label: "Cutaway" },
  { keys: ["E"], label: "Exploded view" },
  { keys: ["F"], label: "Airflow particles" },
  { keys: ["L"], label: "Labels" },
  { keys: ["V"], label: "Home view" },
  { keys: ["R"], label: "Reset" },
  { keys: ["?"], label: "This list" },
];

const SPEEDS = [1, 4, 16] as const;

export function useShortcuts(store: RuntimeStore, onHelp: () => void) {
  const help = useRef(onHelp);
  help.current = onHelp;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // [ and ] need AltGr / Option on many non-US layouts, so modifiers don't disqualify them (⌘ still does: ⌘[ is Back)
      const bracket = e.key === "[" || e.key === "]";
      if (e.metaKey || ((e.ctrlKey || e.altKey) && !bracket)) return;
      // a held key would strobe toggles and re-load presets; only the speed keys repeat
      if (e.repeat && !bracket) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && (t as HTMLInputElement).type !== "range") return;
      if (t?.closest("dialog[open]")) return;
      const s = store.getState();
      const k = e.key.toLowerCase();
      if (/^[1-9]$/.test(k)) {
        const p = s.mod.presets[Number(k) - 1];
        if (p) s.applyPreset(p.id);
      } else if (k === " " && !(t && /^(BUTTON|A)$/.test(t.tagName))) s.togglePlay();
      else if (k === "c") s.toggleView("cutaway");
      else if (k === "e") s.toggleView("exploded");
      else if (k === "f") s.toggleView("flow");
      else if (k === "l") s.toggleView("labels");
      else if (k === "v") s.resetCamera();
      else if (k === "r") s.reset();
      else if (k === "[" || k === "]") {
        const i = SPEEDS.indexOf(s.speed) + (k === "]" ? 1 : -1);
        s.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))]);
      } else if (k === "m") {
        const ov = s.mod.controls.flatMap((c) => c.controls).find((c): c is OverrideControl<any, Outputs> => c.kind === "override"); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!ov) return;
        const cur = ov.get(s.inputs);
        const manual = cur.mode === "manual";
        s.setInputs((i) => ov.set(i, { mode: manual ? "auto" : "manual", value: manual ? cur.value : Math.round(ov.programValue(s.outputs)) }));
      } else if (e.key === "?" || (e.key === "/" && e.shiftKey)) help.current();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="chassis-panel m-auto w-[min(420px,calc(100vw-32px))] p-0 text-ink backdrop:bg-black/40 backdrop:backdrop-blur-[2px]"
      aria-labelledby="shortcuts-title"
    >
      <div className="p-5">
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="micro !text-ink">
            Keyboard
          </h2>
          <button type="button" className="key !min-h-[26px] !px-2" onClick={onClose} aria-label="Close">
            Esc
          </button>
        </div>
        <ul className="mt-4 divide-y divide-line">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between py-2 text-[13.5px]">
              <span className="text-ink-2">{s.label}</span>
              <span className="flex gap-1">
                {s.keys.map((k) =>
                  k === "…" ? (
                    <span key={k} className="px-0.5 text-ink-3">
                      …
                    </span>
                  ) : (
                    <kbd key={k} className="key !min-h-[24px] !px-2 !text-[10px]">
                      {k}
                    </kbd>
                  ),
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}
