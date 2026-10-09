import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import type { Tx } from "@/lib/db/client";
import { knowledgePoints, learnerErrors, masteryStates, reviewItems } from "@/lib/db/schema";
import { summarize, updateBeta, type BetaState } from "@/lib/domain/mastery";
import type { ConceptState } from "@/lib/domain/planner";

export async function loadConceptStates(db: Tx, userId: string): Promise<ConceptState[]> {
  const rows = await db
    .select({
      key: knowledgePoints.key,
      title: knowledgePoints.title,
      category: knowledgePoints.category,
      cefrLevel: knowledgePoints.cefrLevel,
      alpha: masteryStates.alpha,
      beta: masteryStates.beta,
      evidence: masteryStates.evidenceCount,
    })
    .from(knowledgePoints)
    .innerJoin(masteryStates, and(eq(masteryStates.conceptKey, knowledgePoints.key), eq(masteryStates.userId, userId)))
    .orderBy(asc(knowledgePoints.key));

  const recurring = await db
    .select({ concept: learnerErrors.conceptKey, n: sql<number>`count(*)::int` })
    .from(learnerErrors)
    .where(and(eq(learnerErrors.userId, userId), eq(learnerErrors.status, "active"), gte(learnerErrors.failureCount, 2)))
    .groupBy(learnerErrors.conceptKey);
  const recurringBy = new Map(recurring.map((r) => [r.concept, r.n]));

  return rows.map((r) => ({
    key: r.key,
    title: r.title,
    category: r.category,
    cefrLevel: r.cefrLevel,
    mean: summarize({ alpha: r.alpha, beta: r.beta }).mean,
    evidence: r.evidence,
    recurringErrors: recurringBy.get(r.key) ?? 0,
  }));
}

export async function dueReviewIds(db: Tx, userId: string, now: Date, limit = 50): Promise<string[]> {
  const rows = await db
    .select({ id: reviewItems.id })
    .from(reviewItems)
    .where(and(eq(reviewItems.userId, userId), lte(reviewItems.due, now)))
    .orderBy(asc(reviewItems.due))
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function recentErrorsForConcept(db: Tx, userId: string, conceptKey: string, limit = 5) {
  return db
    .select({
      id: learnerErrors.id,
      original: learnerErrors.original,
      correction: learnerErrors.correction,
      failure_count: learnerErrors.failureCount,
    })
    .from(learnerErrors)
    .where(and(eq(learnerErrors.userId, userId), eq(learnerErrors.conceptKey, conceptKey)))
    .orderBy(desc(learnerErrors.lastSeenAt))
    .limit(limit);
}

/** Apply one observation to a concept's Beta state (creating it from a neutral prior if missing). */
export async function applyMasteryObservation(
  db: Tx,
  userId: string,
  conceptKey: string,
  outcome: number,
  difficulty: number,
  weight: number,
  now: Date,
): Promise<void> {
  const [row] = await db
    .select()
    .from(masteryStates)
    .where(and(eq(masteryStates.userId, userId), eq(masteryStates.conceptKey, conceptKey)));
  const prior: BetaState = row ?? { alpha: 1, beta: 1 };
  const next = updateBeta(prior, outcome, difficulty, weight);
  await db
    .insert(masteryStates)
    .values({ userId, conceptKey, ...next, evidenceCount: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [masteryStates.userId, masteryStates.conceptKey],
      set: { alpha: next.alpha, beta: next.beta, evidenceCount: sql`${masteryStates.evidenceCount} + 1`, updatedAt: now },
    });
}
