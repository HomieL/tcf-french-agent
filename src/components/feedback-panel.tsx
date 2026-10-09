import type { AttemptFeedback } from "@/lib/services/feedback";

export function FeedbackPanel({ fb, exerciseType }: { fb: AttemptFeedback; exerciseType?: string }) {
  if (fb.status === "rejected") {
    return (
      <div className="rounded-lg bg-warn-soft p-3 text-sm text-warn" role="alert">
        {fb.failedChecks.filter((c) => c.severity === "block").map((c) => (
          <p key={c.name}>{c.detail}</p>
        ))}
      </div>
    );
  }
  if (fb.status === "analysis_failed") {
    return (
      <div className="rounded-lg bg-warn-soft p-3 text-sm text-warn" role="alert">
        {fb.message}
      </div>
    );
  }
  if (fb.status === "recorded") {
    return <p className="text-sm text-good">{fb.message ?? "Saved."}</p>;
  }

  const isWriting = exerciseType === "short_writing";
  const verdict = isWriting
    ? fb.errors.length === 0
      ? { text: "No language errors found", tone: "good" }
      : { text: `${fb.errors.length} thing${fb.errors.length > 1 ? "s" : ""} to fix`, tone: "warn" }
    : fb.isCorrect
      ? { text: "Correct", tone: "good" }
      : { text: "Not quite", tone: "bad" };
  const toneClass = { good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad" }[verdict.tone];

  return (
    <div className="space-y-3 text-sm" data-testid="feedback">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 font-medium ${toneClass}`} data-testid="verdict">
          {verdict.text}
        </span>
        <span className="chip">{fb.evaluationSource === "deterministic" ? "Checked exactly" : "AI feedback"}</span>
        {fb.isRevision && <span className="chip">Revision</span>}
        {fb.evaluationSource === "llm" && fb.confidence !== null && fb.confidence < 0.6 && (
          <span className="chip border-warn text-warn" title="The evaluator was unsure. Treat this feedback as a suggestion.">
            Low confidence ({Math.round(fb.confidence * 100)}%)
          </span>
        )}
      </div>

      {fb.message && <p className="text-muted">{fb.message}</p>}
      {fb.feedbackSummary && fb.evaluationSource === "llm" && <p>{fb.feedbackSummary}</p>}

      {fb.errors.length > 0 && (
        <ul className="space-y-2">
          {fb.errors.map((e, i) => (
            <li key={i} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-bad line-through decoration-1">{e.original}</span>
                {e.correction !== null && (
                  <>
                    <span className="text-muted">→</span>
                    <span className="font-medium text-good">{e.correction}</span>
                  </>
                )}
                <span className="chip ml-auto">{e.category}</span>
              </div>
              <p className="mt-1 text-muted">{e.explanation ?? `Hint: ${e.hint}`}</p>
            </li>
          ))}
        </ul>
      )}

      {fb.improvedVersion && (
        <div>
          <p className="mb-1 font-medium">Improved version</p>
          <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3">{fb.improvedVersion}</p>
        </div>
      )}

      {fb.expectedAnswers && !fb.isCorrect && (
        <p>
          <span className="text-muted">Expected: </span>
          <span className="font-medium">{fb.expectedAnswers.join(" / ")}</span>
        </p>
      )}
      {fb.expectedAnswers && fb.isCorrect && fb.expectedAnswers.length > 1 && (
        <p className="text-muted">Also accepted: {fb.expectedAnswers.join(" / ")}</p>
      )}

      {fb.unsupportedClaimsDropped > 0 && (
        <p className="text-xs text-muted">
          {fb.unsupportedClaimsDropped} AI claim{fb.unsupportedClaimsDropped > 1 ? "s" : ""} discarded because {fb.unsupportedClaimsDropped > 1 ? "they" : "it"} did not quote your text.
        </p>
      )}
    </div>
  );
}
