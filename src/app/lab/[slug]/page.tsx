import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEntry, liveEntries } from "@/lab/registry";
import { LabModuleView } from "@/lab/shell/LabModuleView";

export function generateStaticParams() {
  return liveEntries().map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const entry = getEntry((await params).slug);
  return entry ? { title: entry.title, description: entry.insight } : {};
}

export default async function LabPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = getEntry(slug);
  if (!entry?.load) notFound();
  // `?preset=` is read on the client so this page stays fully static
  return <LabModuleView slug={slug} />;
}
