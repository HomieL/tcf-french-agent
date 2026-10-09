import { describe, expect, it } from "vitest";

import { AttemptPipeline, IllegalTransitionError, assertSessionTransition } from "@/lib/domain/attempt-pipeline";
import { aggregate, priorFromConfidence, summarize, updateBeta } from "@/lib/domain/mastery";
import { conceptPriority, planLesson, type ConceptState } from "@/lib/domain/planner";
import { gradeCard, newCard } from "@/lib/domain/scheduling";

describe("AttemptPipeline", () => {
  it("follows the legal path and records a trace", () => {
    const p = new AttemptPipeline(() => new Date("2026-09-24T10:00:00Z"));
    p.transition("validated");
    p.transition("analyzing");
    p.transition("analyzed");
    p.transition("applied");
    expect(p.state).toBe("applied");
    expect(p.isTerminal).toBe(true);
    expect(p.trace.map((t) => t.state)).toEqual(["received", "validated", "analyzing", "analyzed", "applied"]);
  });
  it("rejects illegal transitions (e.g. applying model output that was never validated)", () => {
    const p = new AttemptPipeline();
    expect(() => p.transition("applied")).toThrow(IllegalTransitionError);
    p.transition("rejected");
    expect(() => p.transition("validated")).toThrow(IllegalTransitionError);
  });
  it("prevents a failed analysis from being applied", () => {
    const p = new AttemptPipeline();
    p.transition("validated");
    p.transition("analyzing");
    p.transition("analysis_failed");
    expect(() => p.transition("applied")).toThrow(IllegalTransitionError);
  });
  it("guards session transitions", () => {
    expect(() => assertSessionTransition("ready", "in_progress")).not.toThrow();
    expect(() => assertSessionTransition("completed", "in_progress")).toThrow(IllegalTransitionError);
    expect(() => assertSessionTransition("abandoned", "completed")).toThrow(IllegalTransitionError);
  });
});

describe("mastery", () => {
  it("builds a weak prior from self-rated confidence", () => {
    expect(summarize(priorFromConfidence(0.5)).mean).toBeCloseTo(0.5);
    expect(summarize(priorFromConfidence(0.9)).mean).toBeGreaterThan(summarize(priorFromConfidence(0.1)).mean);
  });
  it("moves up on success and down on failure; hard successes count more", () => {
    const s = priorFromConfidence(0.5);
    const base = summarize(s).mean;
    expect(summarize(updateBeta(s, 1)).mean).toBeGreaterThan(base);
    expect(summarize(updateBeta(s, 0)).mean).toBeLessThan(base);
    expect(summarize(updateBeta(s, 1, 0.9)).mean).toBeGreaterThan(summarize(updateBeta(s, 1, 0.1)).mean);
  });
  it("narrows the interval as evidence accumulates", () => {
    let s = priorFromConfidence(0.5);
    const width0 = summarize(s).high - summarize(s).low;
    for (let i = 0; i < 20; i++) s = updateBeta(s, i % 3 === 0 ? 0 : 1);
    const sum = summarize(s);
    expect(sum.high - sum.low).toBeLessThan(width0 / 2);
    expect(sum.low).toBeGreaterThanOrEqual(0);
    expect(sum.high).toBeLessThanOrEqual(1);
  });
  it("aggregates concept estimates", () => {
    expect(aggregate([])).toBeNull();
    const agg = aggregate([{ mean: 0.2, low: 0.1, high: 0.3 }, { mean: 0.6, low: 0.5, high: 0.7 }]);
    expect(agg?.mean).toBeCloseTo(0.4);
  });
});

describe("FSRS scheduling", () => {
  const now = new Date("2026-09-24T10:00:00Z");
  it("schedules the first review the next day", () => {
    const { due } = newCard(now);
    expect(due.getTime() - now.getTime()).toBe(20 * 3600 * 1000);
  });
  it("pushes the due date out on success and counts lapses on failure", () => {
    const { card } = newCard(now);
    const t1 = new Date("2026-09-25T10:00:00Z");
    const good = gradeCard(card, true, t1);
    expect(good.due.getTime()).toBeGreaterThan(t1.getTime());
    const good2 = gradeCard(good.card, true, good.due);
    expect(good2.due.getTime() - good.due.getTime()).toBeGreaterThan(good.due.getTime() - t1.getTime());
    const again = gradeCard(good2.card, false, good2.due);
    expect(again.lapses).toBe(1);
    expect(again.due.getTime() - good2.due.getTime()).toBeLessThan(24 * 3600 * 1000);
  });
});

function concept(key: string, mean: number, extra: Partial<ConceptState> = {}): ConceptState {
  return { key, title: key, category: "grammar", cefrLevel: "B1", mean, evidence: 3, recurringErrors: 0, ...extra };
}

describe("planLesson", () => {
  const concepts = [
    concept("a_strong", 0.9),
    concept("b_weak", 0.2),
    concept("c_mid", 0.5),
    concept("r_read", 0.4, { category: "comprehension" }),
  ];
  const base = { dueReviewIds: [], concepts, writingConcepts: ["c_mid", "a_strong"], daysToExam: null };

  it("always fills exactly the requested minutes", () => {
    for (const minutes of [15, 30, 45] as const) {
      for (const due of [[], ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]]) {
        const plan = planLesson({ ...base, minutes, dueReviewIds: due });
        expect(plan.blocks.reduce((a, b) => a + b.minutes, 0)).toBe(minutes);
      }
    }
  });

  it("builds a short 15-minute plan without writing or reflection", () => {
    const plan = planLesson({ ...base, minutes: 15 });
    expect(plan.blocks.map((b) => b.type)).toEqual(["targeted_drill"]);
    expect(plan.blocks[0].concepts).toEqual(["b_weak"]);
  });

  it("includes review, drill, reading, writing and reflection at 45 minutes", () => {
    const plan = planLesson({ ...base, minutes: 45, dueReviewIds: ["r1", "r2"] });
    expect(plan.blocks.map((b) => b.type)).toEqual(["retrieval_review", "targeted_drill", "reading", "writing", "reflection"]);
    expect(plan.blocks[0].reviewItemIds).toEqual(["r1", "r2"]);
    expect(plan.blocks[1].concepts).toEqual(["b_weak", "c_mid"]);
    // Writing targets the weakest concept that has a writing task.
    expect(plan.blocks[3].concepts).toEqual(["c_mid"]);
  });

  it("caps reviews and says how many are overdue", () => {
    const due = Array.from({ length: 12 }, (_, i) => `r${i}`);
    const plan = planLesson({ ...base, minutes: 15, dueReviewIds: due });
    expect(plan.blocks[0].itemCount).toBe(3);
    expect(plan.blocks[0].rationale).toContain("12");
  });

  it("gives spare review time to extra drill items", () => {
    const withReviews = planLesson({ ...base, minutes: 30, dueReviewIds: ["r1", "r2", "r3", "r4", "r5"] });
    const without = planLesson({ ...base, minutes: 30 });
    const drill = (p: typeof without) => p.blocks.find((b) => b.type === "targeted_drill")!.itemCount;
    expect(drill(without)).toBeGreaterThan(drill(withReviews));
  });

  it("prioritizes recurring errors over a slightly lower mastery", () => {
    const withErrors = concept("x_errors", 0.5, { recurringErrors: 3 });
    const weaker = concept("y_weaker", 0.35);
    expect(conceptPriority(withErrors)).toBeGreaterThan(conceptPriority(weaker));
    const plan = planLesson({ ...base, concepts: [withErrors, weaker], minutes: 15 });
    expect(plan.blocks[0].concepts).toEqual(["x_errors"]);
    expect(plan.blocks[0].rationale).toContain("3 recurring errors");
  });

  it("is deterministic", () => {
    const a = planLesson({ ...base, minutes: 45, dueReviewIds: ["r1"] });
    const b = planLesson({ ...base, minutes: 45, dueReviewIds: ["r1"] });
    expect(a).toEqual(b);
  });

  it("mentions an approaching exam", () => {
    const plan = planLesson({ ...base, minutes: 30, daysToExam: 20 });
    expect(plan.blocks.find((b) => b.type === "writing")!.rationale).toContain("Exam in 20 days");
  });
});
