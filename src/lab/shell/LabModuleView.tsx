"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ControlSectionView } from "../controls/ControlSection";
import { CATEGORIES, entriesIn, registry, type RegistryEntry } from "../registry";
import type { Outputs } from "../types";
import { Display } from "./Display";
import { ExplainerCard } from "./ExplainerCard";
import { ModuleHost } from "./ModuleHost";
import { PresetsBar } from "./PresetsBar";
import { useRuntime, useRuntimeStore } from "./runtime";
import { ShortcutsDialog, useShortcuts } from "./Shortcuts";

function ModuleKey({ e, current }: { e: RegistryEntry; current: boolean }) {
  if (!e.load)
    return (
      <span className="key !min-h-[30px] !px-2.5 opacity-50" title={`${e.number} ${e.title}: coming soon`} aria-disabled>
        <span className="text-ink-3">{e.number}</span>
      </span>
    );
  return (
    <Link
      href={`/lab/${e.slug}`}
      aria-current={current ? "page" : undefined}
      aria-label={`${e.number} ${e.title}`}
      title={current ? undefined : `${e.number} ${e.title}`}
      className={cn("key !min-h-[30px] !px-2.5", current && "!bg-ink !text-panel")}
      data-on={current}
    >
      <span className={cn(current ? "text-accent" : "text-ink-3")}>{e.number}</span>
      {current && <span className="max-w-[17ch] truncate xl:max-w-[30ch]">{e.title}</span>}
    </Link>
  );
}

/** Phones: one key with the current module that opens the whole list, grouped */
function ModulePicker({ slug }: { slug?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = registry.find((e) => e.slug === slug);
  useEffect(() => {
    if (!open) return;
    const away = (ev: PointerEvent) => {
      if (!ref.current?.contains(ev.target as Node)) setOpen(false);
    };
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="flex min-w-0 flex-1 justify-end md:hidden">
      <button
        type="button"
        className="key !min-h-[30px] min-w-0 !px-2.5"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        {current ? (
          <>
            <span className="text-accent">{current.number}</span>
            <span className="min-w-0 truncate">{current.title}</span>
          </>
        ) : (
          <span>Modules</span>
        )}
        <svg viewBox="0 0 10 10" className={cn("size-2.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden>
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        // anchored to the header, so it spans the page's width whatever the key's size
        <div className="chassis-panel absolute inset-x-0 top-[calc(100%-6px)] z-[90] p-2 shadow-[0_16px_40px_-12px_rgba(0,0,0,.6)]">
          {CATEGORIES.map((c) => (
            <div key={c.id} className="py-1">
              <p className="micro px-2.5 pb-1.5 pt-1">{c.label}</p>
              <ul>
                {entriesIn(c.id).map((e) => {
                  const here = e.slug === slug;
                  const row = (
                    <>
                      <span className={cn("num w-6 shrink-0 text-[12px]", here ? "text-accent" : "text-ink-3")}>{e.number}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] text-ink">{e.title}</span>
                        <span className="block truncate text-[12px] text-ink-3">{e.load ? e.insight : "Coming soon"}</span>
                      </span>
                    </>
                  );
                  return (
                    <li key={e.slug}>
                      {e.load ? (
                        <Link
                          href={`/lab/${e.slug}`}
                          aria-current={here ? "page" : undefined}
                          onClick={() => setOpen(false)}
                          className={cn("flex items-start gap-2 rounded-[8px] px-2.5 py-2 hover:bg-white/5", here && "bg-white/[.06]")}
                        >
                          {row}
                        </Link>
                      ) : (
                        <div className="flex items-start gap-2 px-2.5 py-2 opacity-45" aria-disabled>
                          {row}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LabHeader({ slug, onHelp }: { slug?: string; onHelp?: () => void }) {
  return (
    <header className="relative flex items-center gap-4 py-4 sm:py-5">
      <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label="BAS Lab home">
        <span className="grid size-7 place-items-center rounded-full bg-accent shadow-[inset_0_-2px_0_rgba(0,0,0,.18)]">
          <span className="size-2 rounded-full bg-white/90" />
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          BAS&nbsp;Lab
        </span>
      </Link>
      <span className="grille hidden h-5 flex-1 opacity-70 md:block" aria-hidden />
      {/* wide screens: every module as a numbered key, grouped; the one you're on shows its title */}
      <nav aria-label="Modules" className="hidden items-center gap-3 md:flex">
        {CATEGORIES.map((c, k) => (
          <div key={c.id} role="group" aria-label={c.label} className="flex items-center gap-1">
            {k > 0 && <span className="mr-2 h-5 w-px bg-line-2" aria-hidden />}
            <span className="micro mr-1.5 !text-[9.5px]">{c.label}</span>
            {entriesIn(c.id).map((e) => (
              <ModuleKey key={e.slug} e={e} current={e.slug === slug} />
            ))}
          </div>
        ))}
      </nav>
      <ModulePicker slug={slug} />
      {onHelp && (
        <button type="button" className="round-key !size-[30px] shrink-0 font-mono text-[12px]" onClick={onHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          ?
        </button>
      )}
    </header>
  );
}

function Workbench() {
  const store = useRuntimeStore();
  const mod = useRuntime((s) => s.mod);
  const [help, setHelp] = useState(false);
  useShortcuts(store, () => setHelp(true));

  // keep ?preset= in the address bar so the current preset is shareable
  useEffect(() => {
    const show = (id: string | null) => {
      const url = new URL(window.location.href);
      if (!id || url.searchParams.get("preset") === id) return;
      url.searchParams.set("preset", id);
      window.history.replaceState(null, "", url);
    };
    // a ?preset= that doesn't exist fell back to the default: say so in the address bar
    if (new URL(window.location.href).searchParams.has("preset")) show(store.getState().presetId);
    return store.subscribe((s, p) => {
      if (s.presetId !== p.presetId) show(s.presetId);
    });
  }, [store]);

  const bench = mod.controls.filter((c) => c.slot === "bench");
  const side = mod.controls.filter((c) => c.slot === "side");
  const letter = (k: number) => String.fromCharCode(65 + k);

  return (
    <>
      <LabHeader slug={mod.slug} onHelp={() => setHelp(true)} />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-2 sm:mb-6">
        <h1 className="max-w-[26ch] text-[28px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[40px]">
          <span className="num mr-3 align-top text-[13px] font-normal tracking-normal text-accent sm:text-[14px]">{mod.number}</span>
          {mod.insight}
        </h1>
        <p className="micro max-w-[36ch] leading-relaxed">
          {mod.title} · {mod.presets.length} presets · <span className="pointer-coarse:hidden">drag to orbit · press ? for keys</span>
          <span className="hidden pointer-coarse:inline">full screen to turn and zoom</span>
        </p>
        {mod.intro && <p className="w-full max-w-[68ch] text-[15.5px] leading-relaxed text-ink-2">{mod.intro}</p>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 [grid-template-areas:'display'_'bench'_'side'_'card'] lg:grid-cols-[minmax(0,1fr)_340px] lg:[grid-template-areas:'display_side'_'bench_side'_'card_side'] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="chassis-panel p-3 [grid-area:display] sm:p-4">
          <Display className="aspect-[4/3] w-full sm:aspect-[16/9] xl:aspect-[16/8.4]" />
          <div className="mt-4">
            <PresetsBar />
          </div>
        </div>

        <div className="chassis-panel grid grid-cols-[minmax(0,1fr)] overflow-hidden [grid-area:bench] md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)_minmax(0,1fr)]">
          {bench.map((s, k) => (
            <ControlSectionView
              key={s.id}
              spec={s}
              index={letter(k)}
              className={cn(
                "@container border-line max-md:border-t max-md:first:border-t-0 md:max-xl:[&:nth-child(2)]:border-l xl:[&:not(:first-child)]:border-l",
                // an odd last instrument spans the row until three columns fit
                k === bench.length - 1 && bench.length % 2 === 1 && "md:max-xl:col-span-2 md:max-xl:border-t",
              )}
            />
          ))}
        </div>

        <aside className="[grid-area:side] lg:sticky lg:top-4 lg:self-start" aria-label="Controls">
          <div className="chassis-panel divide-y divide-line overflow-hidden lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:no-scrollbar">
            {side.map((s, k) => (
              <ControlSectionView key={s.id} spec={s as never} index={letter(bench.length + k)} />
            ))}
          </div>
        </aside>

        <ExplainerCard className="[grid-area:card]" />
      </div>

      <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
    </>
  );
}

function Skeleton({ slug }: { slug: string }) {
  return (
    <>
      <LabHeader slug={slug} />
      <div className="chassis-panel mt-16 p-4">
        <div className="screen grid aspect-[16/9] place-items-center">
          <span className="num flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-screen-dim">
            <span className="led animate-pulse" data-state="accent" /> Loading module
          </span>
        </div>
      </div>
    </>
  );
}

export function LabModuleView({ slug, preset }: { slug: string; preset?: string }) {
  const [fromUrl, setFromUrl] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setFromUrl(new URLSearchParams(window.location.search).get("preset") ?? undefined);
    setReady(true);
  }, []);
  return (
    <main className="mx-auto max-w-[1520px] px-4 pb-20 sm:px-6">
      {!ready ? (
        <Skeleton slug={slug} />
      ) : (
      <ModuleHost slug={slug} preset={preset ?? fromUrl} fallback={<Skeleton slug={slug} />}>
        <Workbench />
      </ModuleHost>
      )}
    </main>
  );
}

export type { Outputs };
