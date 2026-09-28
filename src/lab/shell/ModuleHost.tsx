"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getEntry } from "../registry";
import type { AnyLabModule } from "../types";
import { createRuntime, RuntimeContext, useSimLoop, type RuntimeStore, type ViewState } from "./runtime";

function Runtime({ mod, preset, view, children }: { mod: AnyLabModule; preset?: string; view?: Partial<ViewState>; children: ReactNode }) {
  const [store] = useState<RuntimeStore>(() => createRuntime(mod, { preset, view }));
  useSimLoop(store);
  return <RuntimeContext.Provider value={store}>{children}</RuntimeContext.Provider>;
}

/** Lazy-loads a module by slug and gives it its own runtime store. */
export function ModuleHost({
  slug,
  preset,
  view,
  fallback,
  children,
}: {
  slug: string;
  preset?: string;
  view?: Partial<ViewState>;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const [mod, setMod] = useState<AnyLabModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setMod(null);
    setError(null);
    const entry = getEntry(slug);
    if (!entry?.load) {
      setError(`No module called “${slug}”.`);
      return;
    }
    entry
      .load()
      .then((m) => live && setMod(m))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [slug]);

  if (error) return <div className="micro p-6 !text-alarm">{error}</div>;
  if (!mod || mod.slug !== slug) return <>{fallback}</>;
  // the store is built once from these props, so a new module or preset gets a fresh one
  return (
    <Runtime key={`${mod.slug}|${preset ?? ""}`} mod={mod} preset={preset} view={view}>
      {children}
    </Runtime>
  );
}
