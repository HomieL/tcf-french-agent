import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { Tx } from "@/lib/db/client";
import { errorOccurrences, knowledgePoints, learnerErrors, reviewItems, reviewLogs } from "@/lib/db/schema";
import type { ExerciseContent } from "@/lib/domain/exercise";
import { gradeCard, newCard } from "@/lib/domain/scheduling";
import { errorFingerprint, replaceFragment, sentenceContaining } from "@/lib/domain/text";
import type { ValidatedError } from "@/lib/llm/schemas";

/** Where an error came from: a closed exercise (retried as-is in review) or open writing. */
export type ErrorSource =
  | { kind: "exercise"; content: Extract<ExerciseContent, { acceptedAnswers: string[] }> }
  | { kind: "writing"; text: string };

export interface RecordedError {
  errorId: string;
  isNew: boolean;
}

/**
 * Record one validated error: link to an existing error (explicit id from the model, else identical
 * fingerprint) or create a new one with its review card. Every occurrence points at its attempt.
 */
export async function recordError(
  db: Tx,
  opts: { userId: string; attemptId: string; error: ValidatedError; source: ErrorSource; now: Date },
): Promise<RecordedError> {
  const { userId, attemptId, error: e, now } = opts;
  const fingerprint = errorFingerprint(e.conceptKey, e.original, e.correction);

  const [existing] = e.existingErrorId
    ? await db.select().from(learnerErrors).where(and(eq(learnerErrors.id, e.existingErrorId), eq(learnerErrors.userId, userId)))
    : await db
        .select()
        .from(learnerErrors)
        .where(and(eq(learnerErrors.userId, userId), eq(learnerErrors.fingerprint, fingerprint)));

  if (existing) {
    await db
      .update(learnerErrors)
      .set({ failureCount: sql`${learnerErrors.failureCount} + 1`, successStreak: 0, status: "active", lastSeenAt: now })
      .where(eq(learnerErrors.id, existing.id));
    await db.insert(errorOccurrences).values({ id: crypto.randomUUID(), errorId: existing.id, attemptId, original: e.original, createdAt: now });
    // A repeated mistake is a lapse: grade the review card "Again" so it comes back soon.
    const [item] = await db.select().from(reviewItems).where(eq(reviewItems.errorId, existing.id));
    if (item) {
      const graded = gradeCard(item.card, false, now);
      await db
        .update(reviewItems)
        .set({ card: graded.card, due: graded.due, reps: graded.reps, lapses: graded.lapses })
        .where(eq(reviewItems.id, item.id));
      await db.insert(reviewLogs).values({
        id: crypto.randomUUID(),
        reviewItemId: item.id,
        attemptId,
        rating: graded.rating,
        previousDue: item.due,
        nextDue: graded.due,
        reviewedAt: now,
      });
    }
    return { errorId: existing.id, isNew: false };
  }

  // Closed items are retried as they were; writing errors ask the learner to fix their own sentence.
  const review =
    opts.source.kind === "exercise"
      ? {
          exerciseType: opts.source.content.type,
          instructions: opts.source.content.instructions,
          prompt: opts.source.content.prompt,
          acceptedAnswers: opts.source.content.acceptedAnswers,
        }
      : (() => {
          const prompt = sentenceContaining(opts.source.text, e.original);
          return {
            exerciseType: "sentence_correction",
            instructions: "Corrigez la phrase.",
            prompt,
            acceptedAnswers: [replaceFragment(prompt, e.original, e.correction)],
          };
        })();

  const errorId = crypto.randomUUID();
  await db.insert(learnerErrors).values({
    id: errorId,
    userId,
    category: e.category,
    conceptKey: e.conceptKey,
    original: e.original,
    correction: e.correction,
    explanation: e.explanation,
    hint: e.hint,
    context: review.prompt,
    fingerprint,
    firstAttemptId: attemptId,
    lastSeenAt: now,
    createdAt: now,
  });
  await db.insert(errorOccurrences).values({ id: crypto.randomUUID(), errorId, attemptId, original: e.original, createdAt: now });

  const { card, due } = newCard(now);
  await db.insert(reviewItems).values({
    id: crypto.randomUUID(),
    userId,
    errorId,
    conceptKey: e.conceptKey,
    ...review,
    answer: review.acceptedAnswers[0],
    explanation: e.explanation,
    card,
    due,
    createdAt: now,
  });
  return { errorId, isNew: true };
}

export async function listErrors(db: Tx, userId: string, filter: { status?: string; concept?: string } = {}) {
  const conditions = [eq(learnerErrors.userId, userId)];
  if (filter.status) conditions.push(eq(learnerErrors.status, filter.status));
  if (filter.concept) conditions.push(eq(learnerErrors.conceptKey, filter.concept));
  return db
    .select({
      id: learnerErrors.id,
      category: learnerErrors.category,
      conceptKey: learnerErrors.conceptKey,
      conceptTitle: knowledgePoints.title,
      original: learnerErrors.original,
      correction: learnerErrors.correction,
      context: learnerErrors.context,
      explanation: learnerErrors.explanation,
      failureCount: learnerErrors.failureCount,
      successStreak: learnerErrors.successStreak,
      status: learnerErrors.status,
      lastSeenAt: learnerErrors.lastSeenAt,
      createdAt: learnerErrors.createdAt,
      nextReviewAt: reviewItems.due,
      occurrences: sql<number>`(select count(*)::int from ${errorOccurrences} where ${errorOccurrences.errorId} = ${learnerErrors.id})`,
    })
    .from(learnerErrors)
    .leftJoin(knowledgePoints, eq(knowledgePoints.key, learnerErrors.conceptKey))
    .leftJoin(reviewItems, eq(reviewItems.errorId, learnerErrors.id))
    .where(and(...conditions))
    .orderBy(desc(learnerErrors.failureCount), desc(learnerErrors.lastSeenAt), asc(learnerErrors.id));
}
