import { and, eq, gte, inArray } from "drizzle-orm";

import type { Tx } from "@/lib/db/client";
import { exercises, lessonSessions, reviewItems } from "@/lib/db/schema";
import { assertSessionTransition } from "@/lib/domain/attempt-pipeline";
import type { SessionStatus } from "@/lib/domain/types";

/** Review items of the session already reviewed since the session was created. */
export async function reviewedInSession(db: Tx, session: { plan: { blocks: { reviewItemIds?: string[] }[] }; createdAt: Date }) {
  const ids = session.plan.blocks.flatMap((b) => b.reviewItemIds ?? []);
  if (ids.length === 0) return new Set<string>();
  const rows = await db
    .select({ id: reviewItems.id })
    .from(reviewItems)
    .where(and(inArray(reviewItems.id, ids), gte(reviewItems.lastReviewedAt, session.createdAt)));
  return new Set(rows.map((r) => r.id));
}

/** Derive the session status from its items: in_progress after any activity, completed when all are done. */
export async function refreshSessionStatus(db: Tx, sessionId: string, now: Date): Promise<SessionStatus | null> {
  const [s] = await db.select().from(lessonSessions).where(eq(lessonSessions.id, sessionId));
  if (!s) return null;
  if (s.status === "completed" || s.status === "abandoned") return s.status;

  const exs = await db.select({ status: exercises.status }).from(exercises).where(eq(exercises.sessionId, sessionId));
  const reviewIds = s.plan.blocks.flatMap((b) => b.reviewItemIds ?? []);
  const reviewed = await reviewedInSession(db, s);
  const allDone = exs.every((e) => e.status === "completed") && reviewed.size === reviewIds.length;
  const next: SessionStatus = allDone ? "completed" : "in_progress";
  assertSessionTransition(s.status, next);
  await db
    .update(lessonSessions)
    .set({ status: next, startedAt: s.startedAt ?? now, completedAt: next === "completed" ? now : null })
    .where(eq(lessonSessions.id, sessionId));
  return next;
}
