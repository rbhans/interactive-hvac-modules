"use client";

import { useId, useState, type ReactNode } from "react";
import { useRuntime } from "./runtime";

const TIP_MAX = 280;
const GUTTER = 8;

/**
 * Inline definition for jargon. Hover, focus, or tap the word; the definition comes from the
 * module's glossary. Works without JavaScript beyond focus, and reads as a description to screen readers.
 *
 * The tooltip is out of layout until shown (an invisible box near the right edge would still widen
 * the page on phones), and it's nudged sideways on open so it stays inside the viewport.
 */
export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const entry = useRuntime((s) => s.mod.glossary?.[id]);
  const tip = useId();
  const [dx, setDx] = useState(0);
  if (!entry) return <>{children}</>;

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = Math.min(TIP_MAX, vw * 0.8);
    const left = r.left + r.width / 2 - w / 2;
    setDx(Math.min(Math.max(left, GUTTER), vw - GUTTER - w) - left);
  };

  return (
    <span className="group/term relative inline">
      <span
        tabIndex={0}
        aria-describedby={tip}
        onPointerEnter={(e) => place(e.currentTarget)}
        onFocus={(e) => place(e.currentTarget)}
        className="cursor-help rounded-[2px] underline decoration-ink-3/60 decoration-dotted underline-offset-[3px] outline-offset-2 hover:decoration-accent focus-visible:decoration-accent"
      >
        {children ?? entry.term}
      </span>
      <span
        id={tip}
        role="tooltip"
        style={{ transform: `translateX(calc(-50% + ${dx}px))` }}
        className="term-tip pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 hidden w-[min(280px,80vw)] rounded-[10px] bg-ink px-3 py-2.5 text-left text-[12.5px] font-normal not-italic leading-snug text-panel shadow-[0_10px_30px_-10px_rgba(0,0,0,.5)] group-focus-within/term:block group-hover/term:block"
      >
        <span className="micro mb-1 block !text-accent">{entry.term}</span>
        {entry.def}
      </span>
    </span>
  );
}
