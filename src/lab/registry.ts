import { asset } from "@/lib/basePath";
import type { AnyLabModule } from "./types";

export interface RegistryEntry {
  slug: string;
  number: string;
  title: string;
  insight: string;
  /** Lazy-loaded module code. The GLB path lives on the module itself. */
  load?: () => Promise<AnyLabModule>;
  glb?: string;
}

/**
 * Slug → lazily loaded module. Adding a module = a folder under src/modules,
 * a GLB under public/lab/<slug>/, and one entry here.
 */
export const registry: RegistryEntry[] = [
  {
    slug: "economizer",
    number: "01",
    title: "Economizer",
    insight: "Damper position isn't outdoor-air percentage.",
    glb: asset("/lab/economizer/scene.glb"),
    load: () => import("@/modules/economizer").then((m) => m.default),
  },
  {
    slug: "coils",
    number: "02",
    title: "Coils & valves",
    insight: "Half the water does most of the work.",
    glb: asset("/lab/coils/scene.glb"),
    load: () => import("@/modules/coils").then((m) => m.default),
  },
  {
    slug: "vav-box",
    number: "03",
    title: "VAV box",
    insight: "Pressure-independent doesn't mean pressure-proof.",
    glb: asset("/lab/vav/scene.glb"),
    load: () => import("@/modules/vav").then((m) => m.default),
  },
  { slug: "static-reset", number: "04", title: "Static pressure reset", insight: "Trim & respond, one request at a time." },
];

export const getEntry = (slug: string) => registry.find((e) => e.slug === slug);
export const liveEntries = () => registry.filter((e) => e.load);
