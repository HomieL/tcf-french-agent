import { and, asc, eq, gte, sql } from "drizzle-orm";

import type { Db } from "@/lib/db/client";
import { attempts, knowledgePoints, learnerErrors, lessonSessions, masteryStates, modelRuns, reviewItems } from "@/lib/db/schema";
import { aggregate, summarize, type MasterySummary } from "@/lib/domain/mastery";
import { SKILLS, type Skill } from "@/lib/domain/types";

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

export interface SkillProgress {
  skill: Skill;
  /** null when this skill is not measured by any exercise yet (e.g. listening/speaking before audio). */
  estimate: MasterySummary | null;
  evidence: number;
  measured: boolean;
}

export async function getProgress(db: Db, userId: string, now = new Date()) {
  const concepts = await db
    .select({
      key: knowledgePoints.key,
      title: knowledgePoints.title,
      skill: knowledgePoints.skill,
      category: knowledgePoints.category,
      cefrLevel: knowledgePoints.cefrLevel,
      alpha: masteryStates.alpha,
      beta: masteryStates.beta,
      evidence: masteryStates.evidenceCount,
    })
    .from(knowledgePoints)
    .innerJoin(masteryStates, and(eq(masteryStates.conceptKey, knowledgePoints.key), eq(masteryStates.userId, userId)))
    .orderBy(asc(knowledgePoints.key));

  const conceptViews = concepts.map((c) => ({ ...c, estimate: summarize(c) }));

  const skills: SkillProgress[] = SKILLS.map((skill) => {
    const own = conceptViews.filter((c) => c.skill === skill);
    const evidence = own.reduce((a, c) => a + c.evidence, 0);
    return { skill, estimate: aggregate(own.map((c) => c.estimate)), evidence, measured: own.length > 0 };
  });

  const [activity] = await db
    .select({
      attempts: sql<number>`count(*) filter (where ${attempts.status} = 'applied')::int`,
      correct: sql<number>`count(*) filter (where ${attempts.status} = 'applied' and ${attempts.isCorrect})::int`,
      studyDays: sql<number>`count(distinct (${attempts.createdAt} at time zone 'UTC')::date)::int`,
    })
    .from(attempts)
    .where(eq(attempts.userId, userId));

  const [sessions] = await db
    .select({
      completed: sql<number>`count(*) filter (where ${lessonSessions.status} = 'completed')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(lessonSessions)
    .where(eq(lessonSessions.userId, userId));

  const [errorsAgg] = await db
    .select({
      active: sql<number>`count(*) filter (where ${learnerErrors.status} = 'active')::int`,
      recurring: sql<number>`count(*) filter (where ${learnerErrors.status} = 'active' and ${learnerErrors.failureCount} >= 2)::int`,
      mastered: sql<number>`count(*) filter (where ${learnerErrors.status} = 'mastered')::int`,
    })
    .from(learnerErrors)
    .where(eq(learnerErrors.userId, userId));

  const [reviews] = await db
    .select({ due: sql<number>`count(*) filter (where ${reviewItems.due} <= ${now})::int`, total: sql<number>`count(*)::int` })
    .from(reviewItems)
    .where(eq(reviewItems.userId, userId));

  const telemetry = await getTelemetry(db, userId, new Date(now.getTime() - 30 * 86_400_000));

  const weakest = [...conceptViews]
    .filter((c) => c.evidence > 0)
    .sort((a, b) => a.estimate.mean - b.estimate.mean)
    .slice(0, 5);

  return {
    skills,
    concepts: conceptViews,
    weakest,
    activity: { ...activity, sessionsCompleted: sessions.completed, sessionsTotal: sessions.total },
    errors: errorsAgg,
    reviews,
    telemetry,
  };
}

/** Per-purpose model telemetry: call counts, failure rate, p50/p95 latency, tokens, cost, unsupported claims. */
export async function getTelemetry(db: Db, userId: string, since: Date) {
  const runs = await db
    .select()
    .from(modelRuns)
    .where(and(eq(modelRuns.userId, userId), gte(modelRuns.createdAt, since)));
  const purposes = [...new Set(runs.map((r) => r.purpose))].sort();
  return purposes.map((purpose) => {
    const rs = runs.filter((r) => r.purpose === purpose);
    const ok = rs.filter((r) => r.status === "ok");
    return {
      purpose,
      providers: [...new Set(rs.map((r) => `${r.provider}:${r.model}`))],
      runs: rs.length,
      failures: rs.length - ok.length,
      p50LatencyMs: percentile(ok.map((r) => r.latencyMs), 50),
      p95LatencyMs: percentile(ok.map((r) => r.latencyMs), 95),
      inputTokens: rs.reduce((a, r) => a + r.inputTokens, 0),
      outputTokens: rs.reduce((a, r) => a + r.outputTokens, 0),
      costUsd: rs.reduce((a, r) => a + r.costUsd, 0),
      unsupportedClaims: rs.reduce((a, r) => a + r.unsupportedClaims, 0),
    };
  });
}
