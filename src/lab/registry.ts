import { asset } from "@/lib/basePath";
import type { AnyLabModule } from "./types";

export type Category = "air" | "water";

/** Module groups, in the order the nav and the home page show them */
export const CATEGORIES: { id: Category; label: string; short: string; blurb: string }[] = [
  { id: "air", label: "Air side", short: "Air", blurb: "How the air gets made, moved and metered." },
  { id: "water", label: "Water side", short: "Water", blurb: "How water carries the heat and the cold." },
];

export interface RegistryEntry {
  slug: string;
  number: string;
  title: string;
  insight: string;
  category: Category;
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
    category: "air",
    glb: asset("/lab/economizer/scene.glb"),
    load: () => import("@/modules/economizer").then((m) => m.default),
  },
  {
    slug: "coils",
    number: "02",
    title: "Coils & valves",
    insight: "Half the water does most of the work.",
    category: "air",
    glb: asset("/lab/coils/scene.glb"),
    load: () => import("@/modules/coils").then((m) => m.default),
  },
  {
    slug: "vav-box",
    number: "03",
    title: "VAV box",
    insight: "Pressure-independent doesn't mean pressure-proof.",
    category: "air",
    glb: asset("/lab/vav/scene.glb"),
    load: () => import("@/modules/vav").then((m) => m.default),
  },
  {
    slug: "static-reset",
    number: "04",
    title: "Static pressure reset",
    insight: "Trim & respond, one request at a time.",
    category: "air",
    glb: asset("/lab/reset/scene.glb"),
    load: () => import("@/modules/reset").then((m) => m.default),
  },
  {
    slug: "pumps",
    number: "05",
    title: "Pumps & VFDs",
    insight: "Slow the pump, don't choke it.",
    category: "water",
    glb: asset("/lab/pumps/scene.glb"),
    load: () => import("@/modules/pumps").then((m) => m.default),
  },
  {
    slug: "three-way-valves",
    number: "06",
    title: "Three-way vs. two-way valves",
    insight: "Three-way valves keep the pump at full speed.",
    category: "water",
    glb: asset("/lab/valves3/scene.glb"),
    load: () => import("@/modules/valves3").then((m) => m.default),
  },
  {
    slug: "primary-secondary",
    number: "07",
    title: "Primary-secondary",
    insight: "When the building outpaces the plant, supply runs warm.",
    category: "water",
  },
  {
    slug: "condensing-boilers",
    number: "08",
    title: "Condensing boilers",
    insight: "It only condenses when the water comes back cool.",
    category: "water",
  },
];

export const entriesIn = (c: Category) => registry.filter((e) => e.category === c);

export const getEntry = (slug: string) => registry.find((e) => e.slug === slug);
export const liveEntries = () => registry.filter((e) => e.load);
