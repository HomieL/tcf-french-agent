"use client";

import { useEffect, useRef, useState } from "react";

import type { ReviewResult } from "@/lib/services/reviews";
import { FeedbackPanel } from "./feedback-panel";

function formatDue(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${Math.max(1, mins)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}

export function ReviewCard({
  id,
  exerciseType,
  instructions,
  prompt,
  conceptTitle,
  sessionId,
  done: initiallyDone = false,
  onDone,
}: {
  id: string;
  exerciseType: string;
  instructions: string;
  prompt: string;
  conceptTitle: string | null;
  sessionId?: string;
  done?: boolean;
  onDone?: (r: ReviewResult) => void;
}) {
  const [response, setResponse] = useState(exerciseType === "sentence_correction" ? prompt : "");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  const finished = initiallyDone || result?.feedback.status === "applied";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response, latencyMs: Date.now() - startedAt.current, sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult(data);
      if (data.feedback.status === "applied") onDone?.(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card space-y-3" data-testid="review" data-status={finished ? "done" : "open"}>
      <header className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-medium text-text">Review</span>
        {conceptTitle && <span className="chip">{conceptTitle}</span>}
        {finished && <span className="ml-auto text-good">✓ Done</span>}
      </header>
      <p className="text-sm text-muted">You got this wrong before. {instructions}</p>
      <p className="text-lg" data-testid="prompt">
        {prompt}
      </p>
      {!finished && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {exerciseType === "fill_blank" ? (
            <input className="input" aria-label="Your answer" value={response} onChange={(e) => setResponse(e.target.value)} autoComplete="off" spellCheck={false} />
          ) : (
            <textarea className="input" rows={2} aria-label="Your answer" value={response} onChange={(e) => setResponse(e.target.value)} spellCheck={false} />
          )}
          <button className="btn-primary" type="submit" disabled={busy || !response.trim()}>
            {busy ? "Checking…" : "Check"}
          </button>
        </form>
      )}
      {initiallyDone && !result && <p className="text-sm text-muted">Reviewed in this session.</p>}
      {error && (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-2">
          <FeedbackPanel fb={result.feedback} />
          {result.feedback.status === "applied" && (
            <div className="rounded-lg bg-surface-2 p-3 text-sm">
              <p>
                <span className="text-muted">Correct form: </span>
                <span className="font-medium">{result.expected}</span>
              </p>
              <p className="mt-1 text-muted">{result.explanation}</p>
              {result.nextDue && (
                <p className="mt-1 text-xs text-muted">
                  Next review {formatDue(result.nextDue)}
                  {result.errorStatus === "mastered" ? " · marked as mastered" : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
