import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

import type { SkillConfidence, SessionPlan } from "@/lib/domain/types";
import type { ExerciseContent } from "@/lib/domain/exercise";
import type { ValidatedEvaluation } from "@/lib/llm/schemas";
import type { PipelineTraceEntry, ValidationResult } from "@/lib/domain/attempt-pipeline";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const learnerProfiles = pgTable("learner_profiles", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  targetExam: text("target_exam").notNull().default("tcf_canada"),
  targetNclc: integer("target_nclc").notNull().default(7),
  examDate: text("exam_date"),
  weeklyHours: integer("weekly_hours").notNull(),
  preferredSessionMinutes: integer("preferred_session_minutes").notNull(),
  nativeLanguages: jsonb("native_languages").$type<string[]>().notNull(),
  frenchExperience: text("french_experience").notNull(),
  skillConfidence: jsonb("skill_confidence").$type<SkillConfidence>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Layer 2: curated language knowledge. Original summaries written for this project. */
export const knowledgePoints = pgTable("knowledge_points", {
  key: text("key").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  skill: text("skill").notNull(),
  cefrLevel: text("cefr_level").notNull(),
  ruleSummary: text("rule_summary").notNull(),
  examples: jsonb("examples").$type<string[]>().notNull(),
  sourceType: text("source_type").notNull().default("curated"),
  provenance: text("provenance").notNull(),
  version: integer("version").notNull().default(1),
});

export const lessonSessions = pgTable(
  "lesson_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    localDate: text("local_date").notNull(),
    plannedMinutes: integer("planned_minutes").notNull(),
    status: text("status").notNull(),
    plan: jsonb("plan").$type<SessionPlan>().notNull(),
    plannerVersion: text("planner_version").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
  },
  (t) => [index("lesson_sessions_user_date_idx").on(t.userId, t.localDate)],
);

export const modelRuns = pgTable(
  "model_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    purpose: text("purpose").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    toolCalls: jsonb("tool_calls").$type<string[]>().notNull().default([]),
    unsupportedClaims: integer("unsupported_claims").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("model_runs_user_idx").on(t.userId, t.createdAt)],
);

export const exercises = pgTable(
  "exercises",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id").references(() => lessonSessions.id, { onDelete: "cascade" }),
    blockIndex: integer("block_index").notNull(),
    position: integer("position").notNull(),
    type: text("type").notNull(),
    skill: text("skill").notNull(),
    conceptKey: text("concept_key").references(() => knowledgePoints.key),
    cefrLevel: text("cefr_level").notNull(),
    difficulty: doublePrecision("difficulty").notNull(),
    content: jsonb("content").$type<ExerciseContent>().notNull(),
    /** generated (Layer 4 synthetic) | bank (seed content) | fixed (app-authored prompts) */
    sourceType: text("source_type").notNull(),
    bankId: text("bank_id"),
    modelRunId: text("model_run_id").references(() => modelRuns.id),
    promptVersion: text("prompt_version"),
    status: text("status").notNull().default("pending"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("exercises_session_idx").on(t.sessionId, t.blockIndex, t.position)],
);

export const attempts = pgTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    exerciseId: text("exercise_id").references(() => exercises.id, { onDelete: "cascade" }),
    reviewItemId: text("review_item_id"),
    sessionId: text("session_id"),
    parentAttemptId: text("parent_attempt_id"),
    response: text("response").notNull(),
    latencyMs: integer("latency_ms"),
    hintsUsed: integer("hints_used").notNull().default(0),
    status: text("status").notNull(),
    pipelineTrace: jsonb("pipeline_trace").$type<PipelineTraceEntry[]>().notNull(),
    validation: jsonb("validation").$type<ValidationResult>(),
    evaluation: jsonb("evaluation").$type<ValidatedEvaluation>(),
    evaluationSource: text("evaluation_source").notNull().default("none"),
    isCorrect: boolean("is_correct"),
    score: doublePrecision("score"),
    confidence: doublePrecision("confidence"),
    modelRunId: text("model_run_id").references(() => modelRuns.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("attempts_user_idx").on(t.userId, t.createdAt), index("attempts_exercise_idx").on(t.exerciseId)],
);

export const learnerErrors = pgTable(
  "errors",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    category: text("category").notNull(),
    conceptKey: text("concept_key").references(() => knowledgePoints.key),
    original: text("original").notNull(),
    correction: text("correction").notNull(),
    explanation: text("explanation").notNull(),
    hint: text("hint"),
    /** Where the error happened: the exercise prompt, or the learner's sentence for open writing. */
    context: text("context"),
    fingerprint: text("fingerprint").notNull(),
    failureCount: integer("failure_count").notNull().default(1),
    successStreak: integer("success_streak").notNull().default(0),
    status: text("status").notNull().default("active"),
    firstAttemptId: text("first_attempt_id").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("errors_user_fingerprint_idx").on(t.userId, t.fingerprint)],
);

export const errorOccurrences = pgTable("error_occurrences", {
  id: text("id").primaryKey(),
  errorId: text("error_id")
    .notNull()
    .references(() => learnerErrors.id, { onDelete: "cascade" }),
  attemptId: text("attempt_id")
    .notNull()
    .references(() => attempts.id, { onDelete: "cascade" }),
  original: text("original").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const masteryStates = pgTable(
  "mastery_states",
  {
    userId: text("user_id").notNull(),
    conceptKey: text("concept_key")
      .notNull()
      .references(() => knowledgePoints.key),
    alpha: doublePrecision("alpha").notNull(),
    beta: doublePrecision("beta").notNull(),
    evidenceCount: integer("evidence_count").notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.conceptKey] })],
);

export const reviewItems = pgTable(
  "review_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    errorId: text("error_id")
      .notNull()
      .references(() => learnerErrors.id, { onDelete: "cascade" }),
    conceptKey: text("concept_key"),
    /** Closed items are retried as-is; writing errors become sentence_correction of the learner's sentence. */
    exerciseType: text("exercise_type").notNull().default("sentence_correction"),
    instructions: text("instructions").notNull().default("Corrigez la phrase."),
    prompt: text("prompt").notNull(),
    answer: text("answer").notNull(),
    acceptedAnswers: jsonb("accepted_answers").$type<string[]>().notNull().default([]),
    explanation: text("explanation").notNull(),
    /** Serialized ts-fsrs Card (dates as ISO strings). */
    card: jsonb("card").$type<Record<string, unknown>>().notNull(),
    due: ts("due").notNull(),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    lastReviewedAt: ts("last_reviewed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("review_items_error_idx").on(t.errorId), index("review_items_due_idx").on(t.userId, t.due)],
);

export const reviewLogs = pgTable("review_logs", {
  id: text("id").primaryKey(),
  reviewItemId: text("review_item_id")
    .notNull()
    .references(() => reviewItems.id, { onDelete: "cascade" }),
  attemptId: text("attempt_id").references(() => attempts.id, { onDelete: "set null" }),
  rating: integer("rating").notNull(),
  previousDue: ts("previous_due").notNull(),
  nextDue: ts("next_due").notNull(),
  reviewedAt: ts("reviewed_at").notNull().defaultNow(),
});
