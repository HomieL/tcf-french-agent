import type { attempts } from "@/lib/db/schema";
import type { AttemptState } from "@/lib/domain/attempt-pipeline";
import type { ExerciseContent } from "@/lib/domain/exercise";

type AttemptRow = typeof attempts.$inferSelect;

export interface FeedbackError {
  category: string;
  conceptKey: string | null;
  original: string;
  hint: string;
  correction: string | null;
  explanation: string | null;
}

export interface AttemptFeedback {
  attemptId: string;
  exerciseId: string | null;
  reviewItemId: string | null;
  status: AttemptState;
  /** The learner's own submitted text. */
  response: string;
  failedChecks: { name: string; detail: string; severity: "block" | "warn" }[];
  isCorrect: boolean | null;
  score: number | null;
  confidence: number | null;
  evaluationSource: string;
  feedbackSummary: string | null;
  errors: FeedbackError[];
  improvedVersion: string | null;
  expectedAnswers: string[] | null;
  /** false while the learner is invited to self-correct (corrections withheld). */
  revealed: boolean;
  canRevise: boolean;
  isRevision: boolean;
  message: string | null;
  unsupportedClaimsDropped: number;
}

export function expectedAnswersFor(content: ExerciseContent | null): string[] | null {
  if (!content) return null;
  if ("acceptedAnswers" in content) return content.acceptedAnswers;
  if (content.type === "reading_mcq") return [content.options[content.correctOption]];
  return null;
}

export function buildFeedback(
  row: AttemptRow,
  content: ExerciseContent | null,
  opts: { reveal: boolean; canRevise: boolean; message?: string | null; expectedOverride?: string[] },
): AttemptFeedback {
  const ev = row.evaluation;
  const reveal = opts.reveal;
  return {
    attemptId: row.id,
    exerciseId: row.exerciseId,
    reviewItemId: row.reviewItemId,
    status: row.status as AttemptState,
    response: row.response,
    failedChecks: (row.validation?.checks ?? []).filter((c) => !c.passed).map(({ name, detail, severity }) => ({ name, detail, severity })),
    isCorrect: row.isCorrect,
    score: row.score,
    confidence: row.confidence,
    evaluationSource: row.evaluationSource,
    feedbackSummary: ev?.feedbackSummary ?? null,
    errors: (ev?.errors ?? []).map((e) => ({
      category: e.category,
      conceptKey: e.conceptKey,
      original: e.original,
      hint: e.hint,
      correction: reveal ? e.correction : null,
      explanation: reveal ? e.explanation : null,
    })),
    improvedVersion: reveal ? (ev?.improvedVersion ?? null) : null,
    expectedAnswers: reveal && row.status === "applied" ? (opts.expectedOverride ?? expectedAnswersFor(content)) : null,
    revealed: reveal,
    canRevise: opts.canRevise,
    isRevision: row.parentAttemptId !== null,
    message: opts.message ?? null,
    unsupportedClaimsDropped: ev?.droppedClaims.length ?? 0,
  };
}
