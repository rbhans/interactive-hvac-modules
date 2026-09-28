"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useRuntime } from "./runtime";
import { Term } from "./Term";

const ActiveSection = createContext<string | null>(null);

function CardSection({ id, children }: { id: string; title?: string; children: ReactNode }) {
  const active = useContext(ActiveSection);
  if (active !== id) return null;
  return (
    <div role="tabpanel" id={`card-${id}`} aria-labelledby={`card-tab-${id}`} className="card-prose">
      {children}
    </div>
  );
}

export function ExplainerCard({ className }: { className?: string }) {
  const mod = useRuntime((s) => s.mod);
  const [active, setActive] = useState(mod.cardSections[0]?.id ?? null);
  const Card = mod.Card as React.ComponentType<{ components?: Record<string, unknown> }>;
  const idx = mod.cardSections.findIndex((s) => s.id === active);

  return (
    <section className={cn("chassis-panel", className)} aria-label="Explainer">
      <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="border-line p-4 max-md:border-b md:border-r md:p-5">
          <div className="micro mb-3">Explainer</div>
          <div role="tablist" aria-orientation="vertical" className="flex gap-1 overflow-x-auto no-scrollbar md:flex-col">
            {mod.cardSections.map((s, k) => (
              <button
                key={s.id}
                id={`card-tab-${s.id}`}
                type="button"
                role="tab"
                aria-selected={active === s.id}
                // only the active panel is rendered
                aria-controls={active === s.id ? `card-${s.id}` : undefined}
                onClick={() => setActive(s.id)}
                className={cn(
                  "group flex flex-none items-baseline gap-3 rounded-[8px] px-2.5 py-2 text-left transition-colors",
                  active === s.id ? "bg-ink text-panel" : "text-ink-2 hover:bg-panel-2",
                )}
              >
                <span className={cn("num text-[10px]", active === s.id ? "text-accent" : "text-ink-3")}>{String(k + 1).padStart(2, "0")}</span>
                <span className="whitespace-nowrap text-[13.5px] font-medium md:whitespace-normal">{s.title}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="p-5 md:p-7">
          <h3 className="mb-3 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{mod.cardSections[idx]?.title}</h3>
          <div className="max-w-[64ch]">
            <ActiveSection.Provider value={active}>
              <Card components={{ CardSection, Term }} />
            </ActiveSection.Provider>
          </div>
          <div className="mt-6 flex items-center gap-2">
            <button type="button" className="key !min-h-[30px]" disabled={idx <= 0} onClick={() => setActive(mod.cardSections[idx - 1].id)}>
              ← Prev
            </button>
            <button type="button" className="key !min-h-[30px]" disabled={idx >= mod.cardSections.length - 1} onClick={() => setActive(mod.cardSections[idx + 1].id)}>
              Next →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
