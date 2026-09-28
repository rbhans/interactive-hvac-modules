import type { ReactNode } from "react";
import { LabIndexHeader } from "../LabIndexHeader";

export function LessonShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-[760px] px-4 pb-24 sm:px-6">
      <LabIndexHeader />
      <article className="lesson mt-8">{children}</article>
    </main>
  );
}
