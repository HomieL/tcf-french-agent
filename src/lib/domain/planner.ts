import type { PlannedBlock, SessionLength, SessionPlan } from "./types";

export const PLANNER_VERSION = "planner-v1";

export interface ConceptState {
  key: string;
  title: string;
  category: string;
  cefrLevel: string;
  /** Mastery mean (0..1). */
  mean: number;
  evidence: number;
  /** Active errors on this concept seen at least twice. */
  recurringErrors: number;
}

export interface PlannerInput {
  minutes: SessionLength;
  dueReviewIds: string[];
  concepts: ConceptState[];
  /** Concepts that have a writing task available. */
  writingConcepts: string[];
  daysToExam: number | null;
}

interface LengthConfig {
  reviewCap: number;
  drillItems: number;
  drillConcepts: number;
  readingItems: number;
  writing: { minutes: number } | null;
  reflection: boolean;
}

const CONFIG: Record<SessionLength, LengthConfig> = {
  15: { reviewCap: 3, drillItems: 4, drillConcepts: 1, readingItems: 0, writing: null, reflection: false },
  30: { reviewCap: 5, drillItems: 5, drillConcepts: 2, readingItems: 1, writing: { minutes: 8 }, reflection: true },
  45: { reviewCap: 8, drillItems: 6, drillConcepts: 2, readingItems: 2, writing: { minutes: 14 }, reflection: true },
};

const MINUTES_PER = { review: 1, drill: 1.5, reading: 3, reflection: 2 };
const CEFR_ORDER: Record<string, number> = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4 };

/**
 * Priority of a concept for today: low mastery, recurring errors, and (for unseen concepts)
 * curriculum order all raise it. Ties break on key so plans are reproducible.
 */
export function conceptPriority(c: ConceptState): number {
  const recurring = 0.25 * Math.min(c.recurringErrors, 4);
  const unseenBonus = c.evidence === 0 ? 0.1 - 0.03 * (CEFR_ORDER[c.cefrLevel] ?? 2) : 0;
  return 1 - c.mean + recurring + unseenBonus;
}

function rank(concepts: ConceptState[]): ConceptState[] {
  return [...concepts].sort((a, b) => conceptPriority(b) - conceptPriority(a) || a.key.localeCompare(b.key));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function describe(c: ConceptState): string {
  const parts = [`${c.title} (est. ${pct(c.mean)}${c.evidence === 0 ? ", not yet practiced" : ""})`];
  if (c.recurringErrors > 0) parts.push(`${c.recurringErrors} recurring error${c.recurringErrors > 1 ? "s" : ""}`);
  return parts.join(", ");
}

export function planLesson(input: PlannerInput): SessionPlan {
  const cfg = CONFIG[input.minutes];
  const blocks: PlannedBlock[] = [];

  const grammar = rank(input.concepts.filter((c) => c.category !== "comprehension"));
  const reading = rank(input.concepts.filter((c) => c.category === "comprehension"));

  const reviewIds = input.dueReviewIds.slice(0, cfg.reviewCap);
  if (reviewIds.length > 0) {
    blocks.push({
      type: "retrieval_review",
      minutes: reviewIds.length * MINUTES_PER.review,
      concepts: [],
      itemCount: reviewIds.length,
      reviewItemIds: reviewIds,
      rationale: `${input.dueReviewIds.length} past correction${input.dueReviewIds.length > 1 ? "s are" : " is"} due for spaced review${input.dueReviewIds.length > reviewIds.length ? `; the ${reviewIds.length} most overdue are included` : ""}.`,
    });
  }

  // Unused review time goes to extra drill items.
  const spareReviewSlots = cfg.reviewCap - reviewIds.length;
  const drillItems = cfg.drillItems + Math.floor((spareReviewSlots * MINUTES_PER.review) / MINUTES_PER.drill);
  const drillTargets = grammar.slice(0, cfg.drillConcepts);
  if (drillTargets.length > 0) {
    blocks.push({
      type: "targeted_drill",
      minutes: drillItems * MINUTES_PER.drill,
      concepts: drillTargets.map((c) => c.key),
      itemCount: drillItems,
      rationale: `Targets your highest-priority concepts: ${drillTargets.map(describe).join("; ")}.`,
    });
  }

  if (cfg.readingItems > 0 && reading.length > 0) {
    const target = reading[0];
    blocks.push({
      type: "reading",
      minutes: cfg.readingItems * MINUTES_PER.reading,
      concepts: [target.key],
      itemCount: cfg.readingItems,
      rationale: `Reading practice on ${describe(target)}.`,
    });
  }

  if (cfg.writing) {
    const writable = grammar.filter((c) => input.writingConcepts.includes(c.key));
    const target = writable[0];
    if (target) {
      const examNote =
        input.daysToExam !== null && input.daysToExam <= 60 ? ` Exam in ${input.daysToExam} days: production practice is prioritized.` : "";
      blocks.push({
        type: "writing",
        minutes: cfg.writing.minutes,
        concepts: [target.key],
        itemCount: 1,
        rationale: `Short writing task that exercises ${describe(target)}.${examNote}`,
      });
    }
  }

  if (cfg.reflection) {
    blocks.push({
      type: "reflection",
      minutes: MINUTES_PER.reflection,
      concepts: [],
      itemCount: 1,
      rationale: "Brief reflection to consolidate what you practiced.",
    });
  }

  return { minutes: input.minutes, blocks: fitMinutes(blocks, input.minutes) };
}

/** Scale nominal block durations so they sum exactly to the session length. */
function fitMinutes(blocks: PlannedBlock[], total: number): PlannedBlock[] {
  const nominal = blocks.reduce((a, b) => a + b.minutes, 0);
  if (nominal === 0) return blocks;
  const scaled = blocks.map((b) => ({ ...b, minutes: Math.max(1, Math.round((b.minutes / nominal) * total)) }));
  const diff = total - scaled.reduce((a, b) => a + b.minutes, 0);
  const largest = scaled.reduce((iMax, b, i, arr) => (b.minutes > arr[iMax].minutes ? i : iMax), 0);
  scaled[largest].minutes += diff;
  return scaled;
}
