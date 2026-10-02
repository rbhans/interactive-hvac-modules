import Link from "next/link";
import { CATEGORIES, entriesIn } from "@/lab/registry";
import { LabIndexHeader } from "./LabIndexHeader";

export default function Home() {
  return (
    <main className="mx-auto max-w-[1180px] px-4 pb-24 sm:px-6">
      <LabIndexHeader />
      <section className="mt-10 sm:mt-16">
        <p className="micro">Interactive modules</p>
        <h1 className="mt-3 max-w-[20ch] text-[38px] font-semibold leading-[1.02] tracking-[-0.035em] text-ink sm:text-[64px]">
          One idea per module. Poke it until it breaks.
        </h1>
        <p className="mt-5 max-w-[56ch] text-[16px] leading-relaxed text-ink-2">
          Each module pairs real equipment with BAS-style controls. Command, feedback and physical reality stay on separate
          layers, so you can see exactly where a graphic stops telling the truth.
        </p>
      </section>

      {CATEGORIES.map((c) => (
        <section key={c.id} className="mt-12 sm:mt-14" aria-labelledby={`cat-${c.id}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line pb-3">
            <h2 id={`cat-${c.id}`} className="micro !text-[11px] !text-ink">
              {c.label}
            </h2>
            <p className="text-[14px] text-ink-3">{c.blurb}</p>
          </div>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {entriesIn(c.id).map((e) => {
              const live = Boolean(e.load);
              const body = (
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between">
                    <span className="num text-[13px] text-accent">{e.number}</span>
                    {live ? <span className="led" data-state="ok" /> : <span className="micro">Soon</span>}
                  </div>
                  <h3 className="mt-8 text-[24px] font-semibold tracking-[-0.02em] text-ink">{e.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-snug text-ink-2">{e.insight}</p>
                  {live && <span className="micro mt-6 !text-ink">Open module →</span>}
                </div>
              );
              return (
                <li key={e.slug} className={live ? "" : "opacity-55"}>
                  {live ? (
                    <Link href={`/lab/${e.slug}`} className="chassis-panel block h-full p-5 transition-transform hover:-translate-y-0.5 sm:p-6">
                      {body}
                    </Link>
                  ) : (
                    <div className="chassis-panel h-full p-5 sm:p-6">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="micro mt-12">
        Lesson example: <Link href="/lessons/economizer" className="!text-ink underline decoration-accent underline-offset-4">economizer basics (MDX embed)</Link>
      </p>
    </main>
  );
}
