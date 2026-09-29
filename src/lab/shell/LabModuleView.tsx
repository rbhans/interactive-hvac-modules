"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ControlSectionView } from "../controls/ControlSection";
import { registry } from "../registry";
import type { Outputs } from "../types";
import { Display } from "./Display";
import { ExplainerCard } from "./ExplainerCard";
import { ModuleHost } from "./ModuleHost";
import { PresetsBar } from "./PresetsBar";
import { useRuntime, useRuntimeStore } from "./runtime";
import { ShortcutsDialog, useShortcuts } from "./Shortcuts";

export function LabHeader({ slug, onHelp }: { slug?: string; onHelp?: () => void }) {
  return (
    <header className="flex items-center gap-4 py-4 sm:py-5">
      <Link href="/" className="group flex items-center gap-2.5" aria-label="BAS Lab home">
        <span className="grid size-7 place-items-center rounded-full bg-accent shadow-[inset_0_-2px_0_rgba(0,0,0,.18)]">
          <span className="size-2 rounded-full bg-white/90" />
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          BAS&nbsp;Lab
        </span>
      </Link>
      <span className="grille hidden h-5 flex-1 opacity-70 sm:block" aria-hidden />
      <nav aria-label="Modules" className="flex items-center gap-1 overflow-x-auto no-scrollbar max-sm:flex-1">
        {registry.map((e) =>
          e.load ? (
            <Link
              key={e.slug}
              href={`/lab/${e.slug}`}
              aria-current={e.slug === slug ? "page" : undefined}
              className={cn("key !min-h-[30px] !px-2.5", e.slug === slug && "!bg-ink !text-panel")}
              data-on={e.slug === slug}
            >
              <span className={cn(e.slug === slug ? "text-accent" : "text-ink-3")}>{e.number}</span>
              <span className="max-md:sr-only">{e.title}</span>
            </Link>
          ) : (
            <span key={e.slug} className="key !min-h-[30px] !px-2.5 opacity-40" title={`${e.title}: coming soon`} aria-disabled>
              <span className="text-ink-3">{e.number}</span>
            </span>
          ),
        )}
      </nav>
      {onHelp && (
        <button type="button" className="round-key !size-[30px] font-mono text-[12px]" onClick={onHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
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
