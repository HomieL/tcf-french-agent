import { and, asc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "@/lib/db/client";
import { attempts, knowledgePoints, learnerErrors, lessonSessions, reviewItems, reviewLogs } from "@/lib/db/schema";
import { AttemptPipeline } from "@/lib/domain/attempt-pipeline";
import type { ExerciseContent } from "@/lib/domain/exercise";
import { gradeCard } from "@/lib/domain/scheduling";
import { matchAcceptedAnswer, validateResponse } from "@/lib/domain/validation";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import type { LlmProvider } from "@/lib/llm/provider";
import type { ValidatedEvaluation } from "@/lib/llm/schemas";
import { analyzeWithModel } from "./analysis";
import { buildFeedback, type AttemptFeedback } from "./feedback";
import { applyMasteryObservation } from "./learner-state";
import { getProfile } from "./profile";
import { refreshSessionStatus } from "./session-status";

/** Consecutive successful reviews after which an error is considered mastered. */
export const MASTERED_STREAK = 3;

export const ReviewInputSchema = z.object({
  response: z.string().max(2000),
  latencyMs: z.number().int().min(0).max(3_600_000).nullish(),
  sessionId: z.string().uuid().nullish(),
});

export async function listDueReviews(db: Db, userId: string, now = new Date(), limit = 20) {
  const rows = await db
    .select({
      id: reviewItems.id,
      exerciseType: reviewItems.exerciseType,
      instructions: reviewItems.instructions,
      prompt: reviewItems.prompt,
      conceptKey: reviewItems.conceptKey,
      conceptTitle: knowledgePoints.title,
      due: reviewItems.due,
      reps: reviewItems.reps,
      lapses: reviewItems.lapses,
    })
    .from(reviewItems)
    .leftJoin(knowledgePoints, eq(knowledgePoints.key, reviewItems.conceptKey))
    .where(and(eq(reviewItems.userId, userId), lte(reviewItems.due, now)))
    .orderBy(asc(reviewItems.due))
    .limit(limit);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewItems)
    .where(and(eq(reviewItems.userId, userId), lte(reviewItems.due, now)));
  return { items: rows, totalDue: n };
}

export interface ReviewResult {
  feedback: AttemptFeedback;
  expected: string;
  explanation: string;
  nextDue: string | null;
  errorStatus: string | null;
}

/**
 * Complete a review: the learner rewrites a sentence that contained a past mistake. Grading is
 * deterministic when the answer matches; otherwise the model judges whether it is an acceptable
 * correction. The FSRS card, the error's streak, and concept mastery are then updated.
 */
export async function completeReview(
  db: Db,
  provider: LlmProvider,
  userId: string,
  reviewItemId: string,
  rawInput: unknown,
  now = new Date(),
): Promise<ReviewResult> {
  const parsed = ReviewInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new BadRequestError("Invalid review", z.flattenError(parsed.error));
  const input = parsed.data;

  const [item] = await db.select().from(reviewItems).where(and(eq(reviewItems.id, reviewItemId), eq(reviewItems.userId, userId)));
  if (!item) throw new NotFoundError("Review item not found");
  const [error] = await db.select().from(learnerErrors).where(eq(learnerErrors.id, item.errorId));
  if (input.sessionId) {
    const [s] = await db
      .select({ id: lessonSessions.id })
      .from(lessonSessions)
      .where(and(eq(lessonSessions.id, input.sessionId), eq(lessonSessions.userId, userId)));
    if (!s) throw new NotFoundError("Session not found");
  }

  const type = (["fill_blank", "translation", "sentence_correction"] as const).find((t) => t === item.exerciseType) ?? "sentence_correction";
  const content: Extract<ExerciseContent, { acceptedAnswers: string[] }> = {
    type,
    instructions: item.instructions,
    prompt: item.prompt,
    acceptedAnswers: item.acceptedAnswers.length ? item.acceptedAnswers : [item.answer],
    hint: null,
  };
  const response = input.response.trim();
  const pipeline = new AttemptPipeline(() => now);
  const validation = validateResponse(content, response);
  const baseRow = {
    id: crypto.randomUUID(),
    userId,
    exerciseId: null,
    reviewItemId: item.id,
    sessionId: input.sessionId ?? null,
    response,
    latencyMs: input.latencyMs ?? null,
    validation,
    createdAt: now,
  };
  const expected =
    type === "fill_blank" ? item.prompt.replace(/\s*\([^)]*\)/g, "").replace("___", content.acceptedAnswers[0]) : item.answer;
  const explanation = error?.explanation ?? item.explanation;

  if (!validation.ok) {
    pipeline.transition("rejected");
    const [row] = await db.insert(attempts).values({ ...baseRow, status: pipeline.state, pipelineTrace: pipeline.trace }).returning();
    return { feedback: buildFeedback(row, null, { reveal: false, canRevise: false, message: "Type your corrected sentence." }), expected: "", explanation: "", nextDue: null, errorStatus: error?.status ?? null };
  }
  pipeline.transition("validated");

  let evaluation: ValidatedEvaluation;
  let modelRunId: string | null = null;
  if (matchAcceptedAnswer(content, response) === "exact") {
    pipeline.transition("matched", "exact_match");
    evaluation = {
      source: "deterministic",
      provider: "deterministic",
      isCorrect: true,
      score: 1,
      confidence: 1,
      taskCompleted: true,
      feedbackSummary: "Correct.",
      errors: [],
      improvedVersion: null,
      droppedClaims: [],
    };
  } else {
    pipeline.transition("analyzing");
    const profile = await getProfile(db, userId);
    const outcome = await analyzeWithModel(db, provider, userId, "analyze_review", {
      content,
      conceptKey: item.conceptKey,
      cefrLevel: "B1",
      response,
      nativeLanguages: profile?.nativeLanguages ?? [],
    });
    modelRunId = outcome.modelRunId;
    if (!outcome.ok) {
      pipeline.transition("analysis_failed", outcome.message);
      const [row] = await db.insert(attempts).values({ ...baseRow, status: pipeline.state, pipelineTrace: pipeline.trace, modelRunId }).returning();
      return { feedback: buildFeedback(row, null, { reveal: false, canRevise: false, message: outcome.message }), expected: "", explanation: "", nextDue: null, errorStatus: error?.status ?? null };
    }
    evaluation = outcome.evaluation;
    pipeline.transition("analyzed");
  }

  const result = await db.transaction(async (tx) => {
    pipeline.transition("applied");
    const [row] = await tx
      .insert(attempts)
      .values({
        ...baseRow,
        status: pipeline.state,
        pipelineTrace: pipeline.trace,
        evaluation,
        evaluationSource: evaluation.source,
        isCorrect: evaluation.isCorrect,
        score: evaluation.score,
        confidence: evaluation.confidence,
        modelRunId,
      })
      .returning();

    const graded = gradeCard(item.card, evaluation.isCorrect, now);
    await tx
      .update(reviewItems)
      .set({ card: graded.card, due: graded.due, reps: graded.reps, lapses: graded.lapses, lastReviewedAt: now })
      .where(eq(reviewItems.id, item.id));
    await tx.insert(reviewLogs).values({
      id: crypto.randomUUID(),
      reviewItemId: item.id,
      attemptId: row.id,
      rating: graded.rating,
      previousDue: item.due,
      nextDue: graded.due,
      reviewedAt: now,
    });

    let errorStatus: string | null = null;
    if (error) {
      const streak = evaluation.isCorrect ? error.successStreak + 1 : 0;
      errorStatus = evaluation.isCorrect ? (streak >= MASTERED_STREAK ? "mastered" : error.status) : "active";
      await tx
        .update(learnerErrors)
        .set({
          successStreak: streak,
          status: errorStatus,
          ...(evaluation.isCorrect ? {} : { failureCount: error.failureCount + 1, lastSeenAt: now }),
        })
        .where(eq(learnerErrors.id, error.id));
    }
    if (item.conceptKey) await applyMasteryObservation(tx, userId, item.conceptKey, evaluation.isCorrect ? 1 : 0, 0.5, 0.5, now);
    if (input.sessionId) await refreshSessionStatus(tx, input.sessionId, now);
    return { row, nextDue: graded.due, errorStatus };
  });

  return {
    feedback: buildFeedback(result.row, content, { reveal: true, canRevise: false }),
    expected,
    explanation,
    nextDue: result.nextDue.toISOString(),
    errorStatus: result.errorStatus,
  };
}
