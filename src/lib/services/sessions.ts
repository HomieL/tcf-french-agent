import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "@/lib/db/client";
import { attempts, exercises, knowledgePoints, lessonSessions, reviewItems } from "@/lib/db/schema";
import { REFLECTION_CONTENT, WRITING_BANK } from "@/lib/content/exercise-bank";
import { assertSessionTransition } from "@/lib/domain/attempt-pipeline";
import { toPublicContent, type ExerciseType, type PublicExerciseContent } from "@/lib/domain/exercise";
import { PLANNER_VERSION, planLesson } from "@/lib/domain/planner";
import type { BlockType, PlannedBlock, SessionLength } from "@/lib/domain/types";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import type { LlmProvider } from "@/lib/llm/provider";
import { latestAttemptsByExercise } from "./attempts";
import { buildFeedback, type AttemptFeedback } from "./feedback";
import { prepareExercises, type PreparedExercise } from "./generation";
import { dueReviewIds, loadConceptStates } from "./learner-state";
import { getProfile } from "./profile";
import { refreshSessionStatus, reviewedInSession } from "./session-status";

export const PlanInputSchema = z.object({
  minutes: z.union([z.literal(15), z.literal(30), z.literal(45)]),
  replace: z.boolean().optional(),
});

/** Calendar date in the server's local time zone (YYYY-MM-DD). */
export function localDate(now: Date): string {
  return now.toLocaleDateString("en-CA");
}

const DRILL_TYPES: ExerciseType[] = ["fill_blank", "translation", "sentence_correction"];

export async function getActiveSession(db: Db, userId: string, now: Date) {
  const [s] = await db
    .select()
    .from(lessonSessions)
    .where(
      and(
        eq(lessonSessions.userId, userId),
        eq(lessonSessions.localDate, localDate(now)),
        inArray(lessonSessions.status, ["ready", "in_progress"]),
      ),
    )
    .orderBy(desc(lessonSessions.createdAt))
    .limit(1);
  return s ?? null;
}

function daysUntil(examDate: string | null, now: Date): number | null {
  if (!examDate) return null;
  const ms = new Date(`${examDate}T00:00:00`).getTime() - new Date(`${localDate(now)}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Plan today's session. An unfinished session for today is resumed (continuity) unless `replace`
 * is set, in which case it is abandoned and a new plan is built from the current learner state.
 */
export async function planSession(db: Db, provider: LlmProvider, userId: string, rawInput: unknown, now = new Date()) {
  const parsed = PlanInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new BadRequestError("minutes must be 15, 30 or 45");
  const { minutes, replace } = parsed.data;

  const profile = await getProfile(db, userId);
  if (!profile) throw new BadRequestError("Complete onboarding first");

  const active = await getActiveSession(db, userId, now);
  if (active && !replace) return getSessionView(db, userId, active.id);
  if (active) {
    assertSessionTransition(active.status, "abandoned");
    await db.update(lessonSessions).set({ status: "abandoned" }).where(eq(lessonSessions.id, active.id));
  }

  const plan = planLesson({
    minutes: minutes as SessionLength,
    dueReviewIds: await dueReviewIds(db, userId, now),
    concepts: await loadConceptStates(db, userId),
    writingConcepts: [...new Set(WRITING_BANK.map((w) => w.concept))],
    daysToExam: daysUntil(profile.examDate, now),
  });

  // Fan out generation: one model call per (block, concept), run concurrently.
  const jobs: { blockIndex: number; conceptKey: string; count: number; types: ExerciseType[] }[] = [];
  plan.blocks.forEach((b, blockIndex) => {
    const types = blockTypes(b.type);
    if (!types) return;
    b.concepts.forEach((conceptKey, i) => {
      const count = Math.floor(b.itemCount / b.concepts.length) + (i < b.itemCount % b.concepts.length ? 1 : 0);
      if (count > 0) jobs.push({ blockIndex, conceptKey, count, types });
    });
  });
  const prepared = await Promise.all(
    jobs.map(async (j) => ({ job: j, items: await prepareExercises(db, provider, userId, j) })),
  );
  // Record what was actually prepared: if generation and the bank both ran short, the plan must not overstate it.
  plan.blocks.forEach((b, blockIndex) => {
    if (!blockTypes(b.type)) return;
    b.itemCount = prepared.filter((p) => p.job.blockIndex === blockIndex).reduce((a, p) => a + p.items.length, 0);
  });

  const sessionId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(lessonSessions).values({
      id: sessionId,
      userId,
      localDate: localDate(now),
      plannedMinutes: minutes,
      status: "ready",
      plan,
      plannerVersion: PLANNER_VERSION,
      createdAt: now,
    });
    const rows: (typeof exercises.$inferInsert)[] = [];
    const positions = new Map<number, number>();
    const push = (blockIndex: number, p: PreparedExercise, skill: string) => {
      const position = positions.get(blockIndex) ?? 0;
      positions.set(blockIndex, position + 1);
      rows.push({
        id: crypto.randomUUID(),
        userId,
        sessionId,
        blockIndex,
        position,
        type: p.content.type,
        skill,
        conceptKey: p.conceptKey,
        cefrLevel: p.cefrLevel,
        difficulty: p.difficulty,
        content: p.content,
        sourceType: p.sourceType,
        bankId: p.bankId,
        modelRunId: p.modelRunId,
        promptVersion: p.promptVersion,
        createdAt: now,
      });
    };
    for (const { job, items } of prepared) {
      const skill = plan.blocks[job.blockIndex].type === "reading" ? "reading" : "writing";
      items.forEach((p) => push(job.blockIndex, p, skill));
    }
    plan.blocks.forEach((b, blockIndex) => {
      if (b.type !== "reflection") return;
      rows.push({
        id: crypto.randomUUID(),
        userId,
        sessionId,
        blockIndex,
        position: 0,
        type: "reflection",
        skill: "writing",
        conceptKey: null,
        cefrLevel: "A2",
        difficulty: 0,
        content: REFLECTION_CONTENT,
        sourceType: "fixed",
        createdAt: now,
      });
    });
    if (rows.length > 0) await tx.insert(exercises).values(rows);
  });
  return getSessionView(db, userId, sessionId);
}

function blockTypes(type: BlockType): ExerciseType[] | null {
  switch (type) {
    case "targeted_drill":
      return DRILL_TYPES;
    case "reading":
      return ["reading_mcq"];
    case "writing":
      return ["short_writing"];
    default:
      return null;
  }
}

export interface SessionExerciseView {
  kind: "exercise";
  id: string;
  type: string;
  status: string;
  conceptKey: string | null;
  conceptTitle: string | null;
  sourceType: string;
  content: PublicExerciseContent;
  lastAttempt: AttemptFeedback | null;
}

export interface SessionReviewView {
  kind: "review";
  id: string;
  exerciseType: string;
  instructions: string;
  prompt: string;
  conceptTitle: string | null;
  done: boolean;
}

export interface SessionBlockView extends Omit<PlannedBlock, "reviewItemIds" | "concepts"> {
  index: number;
  concepts: { key: string; title: string }[];
  items: (SessionExerciseView | SessionReviewView)[];
  done: boolean;
}

export interface SessionView {
  id: string;
  status: string;
  plannedMinutes: number;
  localDate: string;
  createdAt: string;
  blocks: SessionBlockView[];
  progress: { done: number; total: number };
}

export async function getSessionView(db: Db, userId: string, sessionId: string): Promise<SessionView> {
  const [s] = await db
    .select()
    .from(lessonSessions)
    .where(and(eq(lessonSessions.id, sessionId), eq(lessonSessions.userId, userId)));
  if (!s) throw new NotFoundError("Session not found");

  const kps = new Map((await db.select({ key: knowledgePoints.key, title: knowledgePoints.title }).from(knowledgePoints)).map((k) => [k.key, k.title]));
  const exs = await db
    .select()
    .from(exercises)
    .where(eq(exercises.sessionId, s.id))
    .orderBy(asc(exercises.blockIndex), asc(exercises.position));
  const latest = await latestAttemptsByExercise(db, userId, exs.map((e) => e.id));
  const revisedParents = new Set(
    (
      await db
        .select({ parent: attempts.parentAttemptId })
        .from(attempts)
        .where(and(eq(attempts.userId, userId), eq(attempts.sessionId, s.id)))
    )
      .map((r) => r.parent)
      .filter(Boolean),
  );

  const reviewIds = s.plan.blocks.flatMap((b) => b.reviewItemIds ?? []);
  const reviewRows = reviewIds.length
    ? await db.select().from(reviewItems).where(and(inArray(reviewItems.id, reviewIds), eq(reviewItems.userId, userId)))
    : [];
  const reviewById = new Map(reviewRows.map((r) => [r.id, r]));
  const reviewed = await reviewedInSession(db, s);

  let done = 0;
  let total = 0;
  const blocks: SessionBlockView[] = s.plan.blocks.map((b, index) => {
    const items: (SessionExerciseView | SessionReviewView)[] = [];
    for (const id of b.reviewItemIds ?? []) {
      const r = reviewById.get(id);
      if (!r) continue;
      items.push({ kind: "review", id, exerciseType: r.exerciseType, instructions: r.instructions, prompt: r.prompt, conceptTitle: r.conceptKey ? (kps.get(r.conceptKey) ?? null) : null, done: reviewed.has(id) });
    }
    for (const e of exs.filter((x) => x.blockIndex === index)) {
      const a = latest.get(e.id);
      // After a revision, show the revision's feedback with corrections revealed.
      const isWritingAwaitingRevision =
        a && e.content.type === "short_writing" && !a.parentAttemptId && !revisedParents.has(a.id) && (a.evaluation?.errors.length ?? 0) > 0;
      items.push({
        kind: "exercise",
        id: e.id,
        type: e.type,
        status: e.status,
        conceptKey: e.conceptKey,
        conceptTitle: e.conceptKey ? (kps.get(e.conceptKey) ?? null) : null,
        sourceType: e.sourceType,
        content: toPublicContent(e.content),
        lastAttempt: a
          ? buildFeedback(a, e.content, { reveal: !isWritingAwaitingRevision, canRevise: Boolean(isWritingAwaitingRevision) && a.status === "applied" })
          : null,
      });
    }
    const itemDone = (it: SessionExerciseView | SessionReviewView) => (it.kind === "review" ? it.done : it.status === "completed");
    done += items.filter(itemDone).length;
    total += items.length;
    return {
      type: b.type,
      minutes: b.minutes,
      itemCount: b.itemCount,
      rationale: b.rationale,
      index,
      concepts: b.concepts.map((k) => ({ key: k, title: kps.get(k) ?? k })),
      items,
      done: items.every(itemDone),
    };
  });

  return {
    id: s.id,
    status: s.status,
    plannedMinutes: s.plannedMinutes,
    localDate: s.localDate,
    createdAt: s.createdAt.toISOString(),
    blocks,
    progress: { done, total },
  };
}

/** Learner-initiated end of session: completed if everything is done, otherwise abandoned. */
export async function finishSession(db: Db, userId: string, sessionId: string, now = new Date()): Promise<SessionView> {
  const [s] = await db
    .select()
    .from(lessonSessions)
    .where(and(eq(lessonSessions.id, sessionId), eq(lessonSessions.userId, userId)));
  if (!s) throw new NotFoundError("Session not found");
  await db.transaction(async (tx) => {
    const derived = await refreshSessionStatus(tx, s.id, now);
    if (derived === "in_progress") {
      assertSessionTransition(derived, "abandoned");
      await tx.update(lessonSessions).set({ status: "abandoned" }).where(eq(lessonSessions.id, s.id));
    }
  });
  return getSessionView(db, userId, sessionId);
}
