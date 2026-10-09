import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/lib/db/client";
import {
  attempts,
  errorOccurrences,
  exercises,
  learnerErrors,
  lessonSessions,
  masteryStates,
  modelRuns,
  reviewItems,
  reviewLogs,
} from "@/lib/db/schema";
import type { ExerciseContent } from "@/lib/domain/exercise";
import { summarize } from "@/lib/domain/mastery";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { getAttemptFeedback, submitExerciseAttempt } from "@/lib/services/attempts";
import { listErrors } from "@/lib/services/error-library";
import { getProfile, upsertProfile } from "@/lib/services/profile";
import { getProgress } from "@/lib/services/progress";
import { completeReview, listDueReviews, MASTERED_STREAK } from "@/lib/services/reviews";
import { finishSession, getSessionView, planSession } from "@/lib/services/sessions";
import { PROFILE, ScriptedProvider, T0, USER, days, evaluation, freshDb, insertExercises, onboard } from "./helpers";

const FILL: ExerciseContent = {
  type: "fill_blank",
  instructions: "Complétez la phrase.",
  prompt: "Hier, nous ___ (aller) au cinéma.",
  acceptedAnswers: ["sommes allés", "sommes allées"],
};
const CORRECTION: ExerciseContent = {
  type: "sentence_correction",
  instructions: "Corrigez la phrase.",
  prompt: "Je suis travaillé hier.",
  acceptedAnswers: ["J'ai travaillé hier."],
};
const WRITING: ExerciseContent = {
  type: "short_writing",
  instructions: "Écrivez.",
  prompt: "Racontez votre fin de semaine.",
  minWords: 8,
  maxWords: 60,
  requiredElements: ["passé composé"],
};
const MCQ: ExerciseContent = {
  type: "reading_mcq",
  instructions: "Lisez.",
  prompt: "Pourquoi ?",
  passage: "Texte.",
  options: ["A", "B", "C"],
  correctOption: 2,
};

async function mastery(db: Db, concept: string) {
  const [m] = await db.select().from(masteryStates).where(and(eq(masteryStates.userId, USER), eq(masteryStates.conceptKey, concept)));
  return m;
}

let db: Db;
let provider: ScriptedProvider;
beforeEach(async () => {
  db = await freshDb();
  provider = new ScriptedProvider();
});

describe("onboarding", () => {
  it("creates the profile and a mastery prior for every knowledge point", async () => {
    await onboard(db);
    const profile = await getProfile(db, USER);
    expect(profile?.nativeLanguages).toEqual(["Mandarin", "English"]);
    const states = await db.select().from(masteryStates).where(eq(masteryStates.userId, USER));
    expect(states.length).toBeGreaterThanOrEqual(18);
    // Reading concepts start from the reading self-rating, grammar from writing.
    const read = await mastery(db, "reading_detail");
    const gram = await mastery(db, "pc_auxiliary");
    expect(summarize(read).mean).toBeGreaterThan(summarize(gram).mean);
  });

  it("validates input and does not reset mastery on update", async () => {
    await expect(upsertProfile(db, USER, { ...PROFILE, weeklyHours: 0 })).rejects.toBeInstanceOf(BadRequestError);
    await expect(upsertProfile(db, USER, { ...PROFILE, preferredSessionMinutes: 20 })).rejects.toBeInstanceOf(BadRequestError);
    await onboard(db);
    await db.update(masteryStates).set({ alpha: 9 }).where(eq(masteryStates.conceptKey, "pc_auxiliary"));
    await upsertProfile(db, USER, { ...PROFILE, displayName: "Renamed" });
    expect((await getProfile(db, USER))?.displayName).toBe("Renamed");
    expect((await mastery(db, "pc_auxiliary")).alpha).toBe(9);
  });
});

describe("session planning", () => {
  it("requires onboarding", async () => {
    await expect(planSession(db, provider, USER, { minutes: 30 }, T0)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("builds a 30-minute session with drill, reading, writing and reflection", async () => {
    await onboard(db);
    const view = await planSession(db, provider, USER, { minutes: 30 }, T0);
    expect(view.status).toBe("ready");
    expect(view.blocks.map((b) => b.type)).toEqual(["targeted_drill", "reading", "writing", "reflection"]);
    expect(view.blocks.reduce((a, b) => a + b.minutes, 0)).toBe(30);
    const drill = view.blocks[0];
    expect(drill.items.length).toBe(drill.itemCount);
    expect(view.blocks[1].items.every((i) => i.kind === "exercise" && i.type === "reading_mcq")).toBe(true);
    expect(view.blocks[2].items[0]).toMatchObject({ kind: "exercise", type: "short_writing" });
    // Answers never leave the server.
    expect(JSON.stringify(view)).not.toMatch(/acceptedAnswers|correctOption/);
    // Mock-served items are labeled as bank content, not as model-generated.
    const rows = await db.select().from(exercises).where(eq(exercises.sessionId, view.id));
    expect(rows.every((r) => r.sourceType !== "generated")).toBe(true);
    // One generation call per (block, concept) is recorded.
    const runs = await db.select().from(modelRuns).where(eq(modelRuns.purpose, "generate_exercises"));
    expect(runs.length).toBe(drill.concepts.length + 2);
  });

  it("resumes today's unfinished session and replaces it only on request", async () => {
    await onboard(db);
    const first = await planSession(db, provider, USER, { minutes: 15 }, T0);
    const again = await planSession(db, provider, USER, { minutes: 45 }, T0);
    expect(again.id).toBe(first.id);
    const replaced = await planSession(db, provider, USER, { minutes: 45, replace: true }, T0);
    expect(replaced.id).not.toBe(first.id);
    expect(replaced.plannedMinutes).toBe(45);
    const [old] = await db.select().from(lessonSessions).where(eq(lessonSessions.id, first.id));
    expect(old.status).toBe("abandoned");
    await expect(planSession(db, provider, USER, { minutes: 20 }, T0)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("falls back to the bank per item when generated items are invalid", async () => {
    await onboard(db);
    provider.generate = async () => ({
      model: "scripted",
      usage: { inputTokens: 1, outputTokens: 1 },
      toolCalls: [],
      output: {
        exercises: [
          {
            type: "fill_blank", cefr_level: "B1", difficulty: 0.5, instructions: "x", prompt: "no blank", passage: null,
            accepted_answers: ["a"], options: [], correct_option: null, min_words: null, max_words: null, required_elements: [], hint: null,
          },
        ],
      },
    });
    const view = await planSession(db, provider, USER, { minutes: 15 }, T0);
    expect(view.blocks[0].items.length).toBe(view.blocks[0].itemCount);
    const runs = await db.select().from(modelRuns).where(eq(modelRuns.purpose, "generate_exercises"));
    expect(runs[0].errorMessage).toContain("1 generated item(s) failed validation");
  });

  it("still builds a session when generation fails entirely", async () => {
    await onboard(db);
    provider.generate = async () => {
      throw new Error("network down");
    };
    const view = await planSession(db, provider, USER, { minutes: 30 }, T0);
    expect(view.progress.total).toBeGreaterThan(0);
    const runs = await db.select().from(modelRuns).where(eq(modelRuns.purpose, "generate_exercises"));
    expect(runs.every((r) => r.status === "error")).toBe(true);
  });
});

describe("attempt pipeline", () => {
  beforeEach(async () => {
    await onboard(db);
  });

  it("grades exact matches deterministically without calling the model", async () => {
    const { ids } = await insertExercises(db, [{ content: FILL }]);
    const before = summarize(await mastery(db, "pc_auxiliary")).mean;
    const fb = await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "Sommes allés", latencyMs: 4000 }, T0);
    expect(fb).toMatchObject({ status: "applied", isCorrect: true, evaluationSource: "deterministic", revealed: true });
    expect(fb.expectedAnswers).toEqual(FILL.type === "fill_blank" ? FILL.acceptedAnswers : []);
    expect(provider.analyzeCalls).toBe(0);
    expect(summarize(await mastery(db, "pc_auxiliary")).mean).toBeGreaterThan(before);
    const [ex] = await db.select().from(exercises).where(eq(exercises.id, ids[0]));
    expect(ex.status).toBe("completed");
    const [a] = await db.select().from(attempts).where(eq(attempts.id, fb.attemptId));
    expect(a.pipelineTrace.map((t) => t.state)).toEqual(["received", "validated", "matched", "applied"]);
  });

  it("rejects invalid responses without consuming the exercise", async () => {
    const { ids } = await insertExercises(db, [{ content: FILL }]);
    const fb = await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "  " }, T0);
    expect(fb.status).toBe("rejected");
    expect(fb.failedChecks[0].name).toBe("non_empty");
    const [ex] = await db.select().from(exercises).where(eq(exercises.id, ids[0]));
    expect(ex.status).toBe("pending");
    await expect(submitExerciseAttempt(db, provider, USER, { exerciseId: "nope", response: "x" }, T0)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("records a wrong answer as an error with an occurrence, review card, and model run", async () => {
    const { ids } = await insertExercises(db, [{ content: FILL }]);
    const before = summarize(await mastery(db, "pc_auxiliary")).mean;
    const fb = await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "avons allé" }, T0);
    expect(fb).toMatchObject({ status: "applied", isCorrect: false, evaluationSource: "llm" });
    expect(fb.errors[0]).toMatchObject({ original: "avons allé", correction: "sommes allés" });

    const errs = await listErrors(db, USER);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ conceptKey: "pc_auxiliary", failureCount: 1, occurrences: 1, status: "active" });
    const [item] = await db.select().from(reviewItems).where(eq(reviewItems.errorId, errs[0].id));
    // Closed items are retried as they were, with every accepted answer; the error keeps its context.
    expect(item).toMatchObject({ exerciseType: "fill_blank", prompt: "Hier, nous ___ (aller) au cinéma.", answer: "sommes allés" });
    expect(item.acceptedAnswers).toEqual(["sommes allés", "sommes allées"]);
    expect(errs[0].context).toBe("Hier, nous ___ (aller) au cinéma.");
    expect(item.due.getTime()).toBeGreaterThan(T0.getTime());

    const runs = await db.select().from(modelRuns).where(eq(modelRuns.purpose, "analyze_response"));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("ok");
    expect(summarize(await mastery(db, "pc_auxiliary")).mean).toBeLessThan(before);

    await expect(submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "sommes allés" }, T0)).rejects.toBeInstanceOf(ConflictError);
  });

  it("deduplicates a recurring mistake and treats it as a review lapse", async () => {
    const { ids } = await insertExercises(db, [{ content: CORRECTION }, { content: CORRECTION }]);
    await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "Je suis travaillé hier" }, T0);
    await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[1], response: "Je suis travaillé hier" }, days(0.1));
    const errs = await db.select().from(learnerErrors).where(eq(learnerErrors.userId, USER));
    expect(errs).toHaveLength(1);
    expect(errs[0].failureCount).toBe(2);
    const occ = await db.select().from(errorOccurrences).where(eq(errorOccurrences.errorId, errs[0].id));
    expect(occ).toHaveLength(2);
    const logs = await db.select().from(reviewLogs);
    expect(logs).toHaveLength(1);
    expect(logs[0].rating).toBe(1); // Again
  });

  it("links to an existing error when the model identifies the same mistake", async () => {
    const { ids } = await insertExercises(db, [{ content: WRITING }, { content: WRITING }]);
    provider.analyze = async () => evaluation([{ original: "je suis travaillé", correction: "j'ai travaillé" }]);
    await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "Samedi, je suis travaillé toute la journée au bureau." }, T0);
    const [first] = await db.select().from(learnerErrors);
    provider.analyze = async (_req, tools) => {
      const existing = await tools.getLearnerErrors("pc_auxiliary");
      return evaluation([{ original: "Je suis mangé", correction: "J'ai mangé", existing_error_id: existing[0].id }]);
    };
    await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[1], response: "Je suis mangé au restaurant avec mes amis samedi." }, T0);
    const errs = await db.select().from(learnerErrors);
    expect(errs).toHaveLength(1);
    expect(errs[0].id).toBe(first.id);
    expect(errs[0].failureCount).toBe(2);
  });

  it("drops unsupported model claims and counts them in telemetry", async () => {
    const { ids } = await insertExercises(db, [{ content: WRITING }]);
    provider.analyze = async () =>
      evaluation([
        { original: "nous avons allé", correction: "nous sommes allés" }, // not in the response
        { original: "je suis travaillé", correction: "j'ai travaillé" },
      ]);
    const fb = await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "Samedi, je suis travaillé toute la journée au bureau." }, T0);
    expect(fb.errors).toHaveLength(1);
    expect(fb.unsupportedClaimsDropped).toBe(1);
    const [run] = await db.select().from(modelRuns).where(eq(modelRuns.purpose, "analyze_response"));
    expect(run.unsupportedClaims).toBe(1);
    expect(await db.select().from(learnerErrors)).toHaveLength(1);
  });

  it("keeps the attempt and the exercise open when analysis fails", async () => {
    const { ids } = await insertExercises(db, [{ content: CORRECTION }]);
    provider.analyze = async () => {
      throw new Error("timeout");
    };
    const fb = await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "Je suis travaillé hier" }, T0);
    expect(fb.status).toBe("analysis_failed");
    expect(fb.message).toMatch(/try submitting again/);
    const [ex] = await db.select().from(exercises).where(eq(exercises.id, ids[0]));
    expect(ex.status).toBe("pending");
    const [run] = await db.select().from(modelRuns);
    expect(run.status).toBe("error");
    expect(await db.select().from(learnerErrors)).toHaveLength(0);
    // A retry succeeds.
    provider.analyze = undefined;
    const retry = await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "Je suis travaillé hier" }, T0);
    expect(retry.status).toBe("applied");
  });

  it("writing: withholds corrections for self-correction, then reveals them on revision without double counting", async () => {
    const { ids } = await insertExercises(db, [{ content: WRITING }]);
    expect((await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "Trop court." }, T0)).status).toBe("rejected");

    const text = "Samedi, je suis travaillé au bureau. Ensuite, je suis allé au cinéma avec mon frère.";
    const first = await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: text }, T0);
    expect(first).toMatchObject({ status: "applied", canRevise: true, revealed: false, improvedVersion: null });
    expect(first.errors[0]).toMatchObject({ original: "je suis travaillé", correction: null, explanation: null });
    expect(first.errors[0].hint).toBeTruthy();

    const revealed = await getAttemptFeedback(db, USER, first.attemptId, true);
    expect(revealed.errors[0].correction).toBe("j'ai travaillé");

    const revision = await submitExerciseAttempt(
      db,
      provider,
      USER,
      { exerciseId: ids[0], response: text.replace("je suis travaillé", "j'ai travaillé"), parentAttemptId: first.attemptId },
      T0,
    );
    expect(revision).toMatchObject({ status: "applied", isRevision: true, revealed: true, canRevise: false });
    expect(revision.errors).toHaveLength(0);
    const [err] = await db.select().from(learnerErrors);
    expect(err.failureCount).toBe(1);

    await expect(
      submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: text, parentAttemptId: first.attemptId }, T0),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("grades reading MCQs deterministically and records reflections", async () => {
    const reflection: ExerciseContent = { type: "reflection", instructions: "", prompt: "?" };
    const { ids } = await insertExercises(db, [{ content: MCQ, concept: "reading_detail" }, { content: MCQ, concept: "reading_detail" }, { content: reflection, concept: null }]);
    const right = await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "2" }, T0);
    const wrong = await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[1], response: "0" }, T0);
    expect(right).toMatchObject({ isCorrect: true, evaluationSource: "deterministic" });
    expect(wrong).toMatchObject({ isCorrect: false, expectedAnswers: ["C"] });
    const refl = await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[2], response: "J'ai compris le texte." }, T0);
    expect(refl.status).toBe("recorded");
    expect(provider.analyzeCalls).toBe(0);
    expect(await db.select().from(learnerErrors)).toHaveLength(0);
  });

  it("isolates learners", async () => {
    await onboard(db, "other-user");
    const { ids, sessionId } = await insertExercises(db, [{ content: FILL }]);
    await expect(submitExerciseAttempt(db, provider, "other-user", { exerciseId: ids[0], response: "x" }, T0)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSessionView(db, "other-user", sessionId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("spaced review", () => {
  beforeEach(async () => {
    await onboard(db);
  });

  async function makeError() {
    const { ids } = await insertExercises(db, [{ content: CORRECTION }]);
    await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "Je suis travaillé hier" }, T0);
    const [item] = await db.select().from(reviewItems);
    return item;
  }

  it("schedules the correction for tomorrow and puts it into the next session", async () => {
    const item = await makeError();
    expect((await listDueReviews(db, USER, T0)).totalDue).toBe(0);
    const due = await listDueReviews(db, USER, days(1));
    expect(due.items.map((i) => i.id)).toEqual([item.id]);
    expect(due.items[0].prompt).toBe("Je suis travaillé hier.");

    const view = await planSession(db, provider, USER, { minutes: 15 }, days(1));
    expect(view.blocks[0].type).toBe("retrieval_review");
    expect(view.blocks[0].items[0]).toMatchObject({ kind: "review", id: item.id, done: false });
  });

  it("updates the card, the error streak, and eventually marks the error mastered", async () => {
    const item = await makeError();
    let now = days(1);
    const r1 = await completeReview(db, provider, USER, item.id, { response: "J'ai travaillé hier." }, now);
    expect(r1.feedback).toMatchObject({ isCorrect: true, evaluationSource: "deterministic" });
    expect(new Date(r1.nextDue!).getTime()).toBeGreaterThan(now.getTime());
    expect(r1.expected).toBe("J'ai travaillé hier.");

    for (let i = 1; i < MASTERED_STREAK; i++) {
      const [cur] = await db.select().from(reviewItems);
      now = new Date(cur.due.getTime() + 1000);
      await completeReview(db, provider, USER, item.id, { response: "j’ai travaillé hier" }, now);
    }
    const [err] = await db.select().from(learnerErrors);
    expect(err.successStreak).toBe(MASTERED_STREAK);
    expect(err.status).toBe("mastered");
    expect(await db.select().from(reviewLogs)).toHaveLength(MASTERED_STREAK);
  });

  it("uses the model for non-matching answers and resets the streak on failure", async () => {
    const item = await makeError();
    const r = await completeReview(db, provider, USER, item.id, { response: "Je suis travaillée hier." }, days(1));
    expect(r.feedback.isCorrect).toBe(false);
    expect(r.errorStatus).toBe("active");
    const [err] = await db.select().from(learnerErrors);
    expect(err.failureCount).toBe(2);
    expect(err.successStreak).toBe(0);
    const [cur] = await db.select().from(reviewItems);
    expect(cur.lapses).toBeGreaterThanOrEqual(0);
    const runs = await db.select().from(modelRuns).where(eq(modelRuns.purpose, "analyze_review"));
    expect(runs).toHaveLength(1);
  });

  it("writing errors are reviewed as the learner's own sentence", async () => {
    const { ids } = await insertExercises(db, [{ content: WRITING }]);
    await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "Samedi, je suis travaillé au bureau. C'était long." }, T0);
    const [item] = await db.select().from(reviewItems);
    expect(item).toMatchObject({ exerciseType: "sentence_correction", prompt: "Samedi, je suis travaillé au bureau.", answer: "Samedi, j'ai travaillé au bureau." });
    const r = await completeReview(db, provider, USER, item.id, { response: "Samedi, j'ai travaillé au bureau" }, days(1));
    expect(r.feedback.isCorrect).toBe(true);
  });

  it("fill-in-the-blank reviews accept any accepted answer and show the full sentence", async () => {
    const { ids } = await insertExercises(db, [{ content: FILL }]);
    await submitExerciseAttempt(db, provider, USER, { exerciseId: ids[0], response: "avons allé" }, T0);
    const [item] = await db.select().from(reviewItems);
    const r = await completeReview(db, provider, USER, item.id, { response: "sommes allées" }, days(1));
    expect(r.feedback).toMatchObject({ isCorrect: true, evaluationSource: "deterministic" });
    expect(r.expected).toBe("Hier, nous sommes allés au cinéma.");
  });

  it("rejects empty review answers and unknown items", async () => {
    const item = await makeError();
    const r = await completeReview(db, provider, USER, item.id, { response: "" }, days(1));
    expect(r.feedback.status).toBe("rejected");
    await expect(completeReview(db, provider, USER, crypto.randomUUID(), { response: "x" }, days(1))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("session lifecycle and progress", () => {
  it("completes a session automatically once every item is done", async () => {
    await onboard(db);
    const view = await planSession(db, provider, USER, { minutes: 30 }, T0);
    const ids = view.blocks.flatMap((b) => b.items).filter((i) => i.kind === "exercise");
    for (const it of ids) {
      if (it.kind !== "exercise") continue;
      const [row] = await db.select().from(exercises).where(eq(exercises.id, it.id));
      const c = row.content;
      const response =
        c.type === "reading_mcq"
          ? String(c.correctOption)
          : "acceptedAnswers" in c
            ? c.acceptedAnswers[0]
            : c.type === "short_writing"
              ? Array.from({ length: c.minWords }, () => "mot").join(" ")
              : "J'ai appris beaucoup aujourd'hui.";
      const fb = await submitExerciseAttempt(db, provider, USER, { exerciseId: it.id, response }, T0);
      expect(fb.status, `${c.type}`).toMatch(/applied|recorded/);
    }
    const done = await getSessionView(db, USER, view.id);
    expect(done.status).toBe("completed");
    expect(done.progress).toEqual({ done: done.progress.total, total: done.progress.total });

    const progress = await getProgress(db, USER, T0);
    expect(progress.activity.sessionsCompleted).toBe(1);
    expect(progress.activity.attempts).toBeGreaterThan(0);
    const writing = progress.skills.find((s) => s.skill === "writing")!;
    expect(writing.measured).toBe(true);
    expect(writing.estimate!.low).toBeLessThanOrEqual(writing.estimate!.mean);
    expect(progress.skills.find((s) => s.skill === "speaking")!.measured).toBe(false);
    expect(progress.telemetry.map((t) => t.purpose)).toContain("generate_exercises");
  });

  it("abandons an unfinished session when the learner ends it", async () => {
    await onboard(db);
    const view = await planSession(db, provider, USER, { minutes: 15 }, T0);
    const ended = await finishSession(db, USER, view.id, T0);
    expect(ended.status).toBe("abandoned");
    const next = await planSession(db, provider, USER, { minutes: 15 }, T0);
    expect(next.id).not.toBe(view.id);
  });

  it("reports latency percentiles and cost per purpose", async () => {
    await onboard(db);
    const { ids } = await insertExercises(db, [{ content: CORRECTION }, { content: CORRECTION }, { content: CORRECTION }]);
    for (const id of ids) await submitExerciseAttempt(db, provider, USER, { exerciseId: id, response: "Je suis travaillé hier" }, T0);
    const { telemetry } = await getProgress(db, USER, T0);
    const analyze = telemetry.find((t) => t.purpose === "analyze_response")!;
    expect(analyze.runs).toBe(3);
    expect(analyze.failures).toBe(0);
    expect(analyze.p50LatencyMs).not.toBeNull();
    expect(analyze.p95LatencyMs!).toBeGreaterThanOrEqual(analyze.p50LatencyMs!);
    expect(analyze.costUsd).toBe(0);
  });
});
