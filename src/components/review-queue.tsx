"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ReviewCard } from "./review-card";

interface DueItem {
  id: string;
  exerciseType: string;
  instructions: string;
  prompt: string;
  conceptTitle: string | null;
}

export function ReviewQueue() {
  const [items, setItems] = useState<DueItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    fetch("/api/reviews/due")
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items);
        setTotal(d.totalDue);
      });
  }, []);

  if (!items) return <p className="text-sm text-muted">Loading…</p>;
  if (index >= items.length) {
    return (
      <div className="card space-y-2" data-testid="reviews-empty">
        <p className="font-medium">{items.length ? "All caught up." : "Nothing is due right now."}</p>
        <p className="text-sm text-muted">New corrections become due the day after a mistake.</p>
        <Link href="/" className="btn-ghost">
          Back to today
        </Link>
      </div>
    );
  }
  const item = items[index];
  return (
    <div className="space-y-4">
      <p className="text-sm tabular-nums text-muted">
        {index + 1} of {Math.min(items.length, total)}
        {total > items.length ? ` (${total} due in total)` : ""}
      </p>
      <ReviewCard key={item.id} id={item.id} exerciseType={item.exerciseType} instructions={item.instructions} prompt={item.prompt} conceptTitle={item.conceptTitle} onDone={() => setAnswered(true)} />
      {answered && (
        <button
          className="btn-primary"
          onClick={() => {
            setAnswered(false);
            setIndex((i) => i + 1);
          }}
        >
          {index + 1 < items.length ? "Next" : "Finish"}
        </button>
      )}
    </div>
  );
}
