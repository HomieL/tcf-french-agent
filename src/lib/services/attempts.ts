import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "@/lib/db/client";
import { attempts, exercises } from "@/lib/db/schema";
import { AttemptPipeline } from "@/lib/domain/attempt-pipeline";
import { hasAcceptedAnswers, type ExerciseContent } from "@/lib/domain/exercise";
import { matchAcceptedAnswer, validateResponse } from "@/lib/domain/validation";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import type { LlmProvider } from "@/lib/llm/provider";
import type { ValidatedEvaluation } from "@/lib/llm/schemas";
import { analyzeWithModel } from "./analysis";
import { recordError, type ErrorSource } from "./error-library";
import { buildFeedback, type AttemptFeedback } from "./feedback";
import { applyMasteryObservation } from "./learner-state";
import { getProfile } from "./profile";
import { refreshSessionStatus } from "./session-status";

export const AttemptInputSchema = z.object({
  exerciseId: z.string().uuid(),
  response: z.string().max(5000),
  latencyMs: z.number().int().min(0).max(3_600_000).nullish(),
  hintsUsed: z.number().int().min(0).max(10).optional(),
  parentAttemptId: z.string().uuid().nullish(),
});

function deterministicEvaluation(isCorrect: boolean, summary: string): ValidatedEvaluation {
  return {
    source: "deterministic",
    provider: "deterministic",
    isCorrect,
    score: isCorrect ? 1 : 0,
    confidence: 1,
    taskCompleted: true,
    feedbackSummary: summary,
    errors: [],
    improvedVersion: null,
    droppedClaims: [],
  };
}

/**
 * Process one exercise attempt through the deterministic pipeline:
 * validate → (deterministic match | model analysis) → validate proposal → apply mutations.
 * The model's output is only a proposal; this function decides what is written.
 */
export async function submitExerciseAttempt(
  db: Db,
  provider: LlmProvider,
  userId: string,
  rawInput: unknown,
  now = new Date(),
): Promise<AttemptFeedback> {
  const parsed = AttemptInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new BadRequestError("Invalid attempt", z.flattenError(parsed.error));
  const input = parsed.data;

  const [ex] = await db.select().from(exercises).where(and(eq(exercises.id, input.exerciseId), eq(exercises.userId, userId)));
  if (!ex) throw new NotFoundError("Exercise not found");
  const content: ExerciseContent = ex.content;

  const isRevision = Boolean(input.parentAttemptId);
  if (isRevision) {
    if (content.type !== "short_writing") throw new BadRequestError("Only writing tasks can be revised");
    const [parent] = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, input.parentAttemptId!), eq(attempts.exerciseId, ex.id), eq(attempts.userId, userId)));
    if (!parent || parent.status !== "applied") throw new BadRequestError("Invalid parent attempt");
    const [existingRevision] = await db.select({ id: attempts.id }).from(attempts).where(eq(attempts.parentAttemptId, parent.id));
    if (existingRevision) throw new ConflictError("This text has already been revised");
  } else if (ex.status === "completed") {
    throw new ConflictError("Exercise already completed");
  }

  const pipeline = new AttemptPipeline(() => now);
  const attemptId = crypto.randomUUID();
  const response = input.response.trim();
  const validation = validateResponse(content, response);

  const baseRow = {
    id: attemptId,
    userId,
    exerciseId: ex.id,
    sessionId: ex.sessionId,
    parentAttemptId: input.parentAttemptId ?? null,
    response,
    latencyMs: input.latencyMs ?? null,
    hintsUsed: input.hintsUsed ?? 0,
    validation,
    createdAt: now,
  };

  if (!validation.ok) {
    pipeline.transition("rejected", validation.checks.filter((c) => !c.passed && c.severity === "block").map((c) => c.name).join(","));
    const [row] = await db.insert(attempts).values({ ...baseRow, status: pipeline.state, pipelineTrace: pipeline.trace }).returning();
    return buildFeedback(row, content, { reveal: false, canRevise: false, message: "Please fix the highlighted issue and resubmit." });
  }
  pipeline.transition("validated");

  if (content.type === "reflection") {
    pipeline.transition("recorded");
    const row = await db.transaction(async (tx) => {
      const [r] = await tx.insert(attempts).values({ ...baseRow, status: pipeline.state, pipelineTrace: pipeline.trace }).returning();
      await tx.update(exercises).set({ status: "completed" }).where(eq(exercises.id, ex.id));
      if (ex.sessionId) await refreshSessionStatus(tx, ex.sessionId, now);
      return r;
    });
    return buildFeedback(row, content, { reveal: true, canRevise: false, message: "Reflection saved." });
  }

  // Step 2: deterministic evaluation when possible (no model call, no cost).
  let evaluation: ValidatedEvaluation | null = null;
  let modelRunId: string | null = null;
  if (content.type === "reading_mcq") {
    const correct = Number(response) === content.correctOption;
    evaluation = deterministicEvaluation(correct, correct ? "Correct." : `The correct answer was: ${content.options[content.correctOption]}`);
    pipeline.transition("matched", "mcq");
  } else if (hasAcceptedAnswers(content) && matchAcceptedAnswer(content, response) === "exact") {
    evaluation = deterministicEvaluation(true, "Correct.");
    pipeline.transition("matched", "exact_match");
  } else {
    // Step 3: model analysis, proposal validated before use.
    pipeline.transition("analyzing");
    const profile = await getProfile(db, userId);
    const outcome = await analyzeWithModel(db, provider, userId, "analyze_response", {
      content,
      conceptKey: ex.conceptKey,
      cefrLevel: ex.cefrLevel,
      response,
      nativeLanguages: profile?.nativeLanguages ?? [],
    });
    modelRunId = outcome.modelRunId;
    if (!outcome.ok) {
      pipeline.transition("analysis_failed", outcome.message);
      const [row] = await db
        .insert(attempts)
        .values({ ...baseRow, status: pipeline.state, pipelineTrace: pipeline.trace, modelRunId })
        .returning();
      return buildFeedback(row, content, { reveal: false, canRevise: false, message: outcome.message });
    }
    evaluation = outcome.evaluation;
    pipeline.transition("analyzed", `${evaluation.errors.length} errors, ${evaluation.droppedClaims.length} dropped`);
  }

  // Step 4: apply validated mutations atomically.
  const closed = hasAcceptedAnswers(content) || content.type === "reading_mcq";
  const row = await db.transaction(async (tx) => {
    const [fresh] = await tx.select({ status: exercises.status }).from(exercises).where(eq(exercises.id, ex.id));
    if (!isRevision && fresh?.status === "completed") throw new ConflictError("Exercise already completed");

    pipeline.transition("applied", isRevision ? "revision: feedback only, no state mutations" : undefined);
    const [r] = await tx
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

    if (!isRevision) {
      const source: ErrorSource = hasAcceptedAnswers(content) ? { kind: "exercise", content } : { kind: "writing", text: response };
      for (const e of evaluation.errors) {
        await recordError(tx, { userId, attemptId, error: e, source, now });
      }
      if (ex.conceptKey) {
        const outcome = closed ? (evaluation.isCorrect ? 1 : 0) : evaluation.score;
        await applyMasteryObservation(tx, userId, ex.conceptKey, outcome, ex.difficulty, 1, now);
      }
      const otherConcepts = new Set(evaluation.errors.map((e) => e.conceptKey).filter((k): k is string => !!k && k !== ex.conceptKey));
      for (const k of otherConcepts) await applyMasteryObservation(tx, userId, k, 0, 0.5, 0.5, now);

      await tx.update(exercises).set({ status: "completed" }).where(eq(exercises.id, ex.id));
      if (ex.sessionId) await refreshSessionStatus(tx, ex.sessionId, now);
    }
    return r;
  });

  // Writing: withhold corrections on the first attempt so the learner can self-correct once.
  const selfCorrect = content.type === "short_writing" && !isRevision && evaluation.errors.length > 0;
  return buildFeedback(row, content, {
    reveal: !selfCorrect,
    canRevise: selfCorrect,
    message: selfCorrect ? "Some parts need attention. Try correcting them yourself before seeing the answers." : null,
  });
}

/** Feedback for an existing attempt (used to reveal corrections after self-correction is skipped). */
export async function getAttemptFeedback(db: Db, userId: string, attemptId: string, reveal: boolean): Promise<AttemptFeedback> {
  const [row] = await db.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId)));
  if (!row) throw new NotFoundError("Attempt not found");
  const [ex] = row.exerciseId ? await db.select().from(exercises).where(eq(exercises.id, row.exerciseId)) : [];
  const [revision] = await db.select({ id: attempts.id }).from(attempts).where(eq(attempts.parentAttemptId, row.id));
  const canRevise = ex?.content.type === "short_writing" && !row.parentAttemptId && !revision && !reveal && (row.evaluation?.errors.length ?? 0) > 0;
  return buildFeedback(row, ex?.content ?? null, { reveal, canRevise });
}

export async function latestAttemptsByExercise(db: Db, userId: string, exerciseIds: string[]) {
  if (exerciseIds.length === 0) return new Map<string, typeof attempts.$inferSelect>();
  const rows = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.userId, userId), inArray(attempts.exerciseId, exerciseIds)))
    .orderBy(desc(attempts.createdAt));
  const map = new Map<string, typeof attempts.$inferSelect>();
  for (const r of rows) if (r.exerciseId && !map.has(r.exerciseId)) map.set(r.exerciseId, r);
  return map;
}
