"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import type { SessionView } from "@/lib/services/sessions";
import { ExerciseCard } from "./exercise-card";
import { ReviewCard } from "./review-card";

const BLOCK_LABEL: Record<string, string> = {
  retrieval_review: "Spaced review",
  targeted_drill: "Targeted drill",
  reading: "Reading",
  writing: "Writing",
  reflection: "Reflection",
};

export function SessionRunner({ initial }: { initial: SessionView }) {
  const [view, setView] = useState(initial);
  const [ending, setEnding] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/sessions/${view.id}`);
    if (res.ok) setView(await res.json());
  }, [view.id]);

  async function finish() {
    setEnding(true);
    const res = await fetch(`/api/sessions/${view.id}/finish`, { method: "POST" });
    if (res.ok) setView(await res.json());
    setEnding(false);
  }

  const pct = view.progress.total ? Math.round((view.progress.done / view.progress.total) * 100) : 0;
  const closed = view.status === "completed" || view.status === "abandoned";
  let counter = 0;

  return (
    <div className="space-y-8">
      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold">{view.plannedMinutes}-minute session</h1>
          <span className="text-sm tabular-nums text-muted" data-testid="progress">
            {view.progress.done}/{view.progress.total} done
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {view.status === "completed" && (
        <div className="card border-good bg-good-soft text-good" data-testid="session-complete">
          <p className="font-medium">Session complete. Bien joué !</p>
          <p className="mt-1 text-sm">
            Your mistakes are now in the <Link className="underline" href="/errors">error library</Link> and scheduled for review.
          </p>
        </div>
      )}
      {view.status === "abandoned" && (
        <div className="card text-sm text-muted">
          This session was ended early. <Link className="underline" href="/">Plan a new one</Link>.
        </div>
      )}

      {view.blocks.map((b) => (
        <section key={b.index} className="space-y-3" data-testid="block" data-block={b.type}>
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              {BLOCK_LABEL[b.type] ?? b.type}
              <span className="text-sm font-normal text-muted">· {b.minutes} min</span>
              {b.done && <span className="text-sm font-normal text-good">✓</span>}
            </h2>
            <p className="text-sm text-muted">{b.rationale}</p>
          </div>
          {b.items.map((it) =>
            it.kind === "review" ? (
              <ReviewCard key={it.id} id={it.id} exerciseType={it.exerciseType} instructions={it.instructions} prompt={it.prompt} conceptTitle={it.conceptTitle} sessionId={view.id} done={it.done} onDone={() => void refresh()} />
            ) : (
              <ExerciseCard key={it.id} item={it} index={counter++} onChanged={() => void refresh()} />
            ),
          )}
        </section>
      ))}

      {!closed && (
        <div className="flex justify-end border-t border-line pt-6">
          <button className="btn-ghost" onClick={() => void finish()} disabled={ending}>
            {view.progress.done === view.progress.total ? "Finish session" : "End session early"}
          </button>
        </div>
      )}
    </div>
  );
}
