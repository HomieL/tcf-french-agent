import { z } from "zod";

import { CEFR_LEVELS, parseExerciseContent, type ExerciseContent } from "@/lib/domain/exercise";
import { containsFragment, normalizeAnswer } from "@/lib/domain/text";

/*
 * Model-facing schemas. They are deliberately flat and free of numeric bounds (structured outputs
 * and strict tools support a JSON Schema subset); all range and cross-field rules are enforced by
 * the validators below, which run on every model proposal before anything touches the database.
 */

export const GENERATABLE_TYPES = ["fill_blank", "translation", "sentence_correction", "reading_mcq", "short_writing"] as const;

export const GeneratedExerciseSchema = z.object({
  type: z.enum(GENERATABLE_TYPES),
  cefr_level: z.enum(CEFR_LEVELS),
  difficulty: z.number().describe("0 (easy) to 1 (hard)"),
  instructions: z.string().describe("Short instruction in French, e.g. 'Complétez la phrase.'"),
  prompt: z.string().describe("The item shown to the learner. fill_blank prompts contain exactly one ___ blank."),
  passage: z.string().nullable().describe("reading_mcq only: the text to read. null otherwise."),
  accepted_answers: z
    .array(z.string())
    .describe("fill_blank/translation/sentence_correction: every acceptable answer. For fill_blank, only the missing words. Empty for other types."),
  options: z.array(z.string()).describe("reading_mcq only: 3-4 options. Empty otherwise."),
  correct_option: z.number().int().nullable().describe("reading_mcq only: 0-based index of the correct option."),
  min_words: z.number().int().nullable().describe("short_writing only."),
  max_words: z.number().int().nullable().describe("short_writing only."),
  required_elements: z.array(z.string()).describe("short_writing only: elements the text must contain."),
  hint: z.string().nullable().describe("Optional hint that does not reveal the answer."),
});
export type GeneratedExercise = z.infer<typeof GeneratedExerciseSchema>;

export const GenerationOutputSchema = z.object({ exercises: z.array(GeneratedExerciseSchema) });
export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;

export function generatedToContent(g: GeneratedExercise): ExerciseContent {
  const common = { instructions: g.instructions.trim(), prompt: g.prompt.trim(), hint: g.hint?.trim() || null };
  switch (g.type) {
    case "fill_blank":
    case "translation":
    case "sentence_correction":
      return parseExerciseContent({ type: g.type, ...common, acceptedAnswers: g.accepted_answers.map((a) => a.trim()).filter(Boolean) });
    case "reading_mcq":
      return parseExerciseContent({
        type: g.type,
        ...common,
        passage: g.passage ?? "",
        options: g.options,
        correctOption: g.correct_option ?? -1,
      });
    case "short_writing":
      return parseExerciseContent({
        type: g.type,
        ...common,
        minWords: g.min_words ?? 0,
        maxWords: g.max_words ?? 0,
        requiredElements: g.required_elements,
      });
  }
}

export const ERROR_CATEGORIES = ["grammar", "vocabulary", "spelling", "syntax", "register", "task"] as const;

export const ProposedErrorSchema = z.object({
  category: z.enum(ERROR_CATEGORIES),
  concept: z.string().describe("Knowledge-point key from the provided list, or 'other'."),
  original: z.string().describe("The exact erroneous fragment, copied verbatim from the learner's response."),
  correction: z.string().describe("The corrected fragment that would replace `original`."),
  explanation: z.string().describe("One or two sentences in English explaining the rule."),
  hint: z.string().describe("A hint that points at the problem without giving the correction."),
  existing_error_id: z
    .string()
    .nullable()
    .describe("If get_learner_errors returned an error that is the same underlying mistake, its id. Otherwise null."),
});

export const EvaluationSchema = z.object({
  is_correct: z.boolean(),
  score: z.number().describe("0 to 1 overall quality for the task."),
  confidence: z.number().describe("0 to 1: how confident you are in this evaluation."),
  task_completed: z.boolean().describe("Whether the response does what the task asked (required elements, topic)."),
  feedback_summary: z.string().describe("Two or three sentences of encouraging, specific feedback in English."),
  errors: z.array(ProposedErrorSchema),
  improved_version: z.string().nullable().describe("A corrected version of the learner's text that keeps their ideas, or null."),
});
export type RawEvaluation = z.infer<typeof EvaluationSchema>;

export interface ValidatedError {
  category: (typeof ERROR_CATEGORIES)[number];
  conceptKey: string | null;
  original: string;
  correction: string;
  explanation: string;
  hint: string;
  existingErrorId: string | null;
}

export interface DroppedClaim {
  original: string;
  correction: string;
  reason: string;
}

export interface ValidatedEvaluation {
  source: "deterministic" | "llm";
  provider: string;
  isCorrect: boolean;
  score: number;
  confidence: number;
  taskCompleted: boolean;
  feedbackSummary: string;
  errors: ValidatedError[];
  improvedVersion: string | null;
  /** Model claims rejected by validation: counted as unsupported claims in telemetry. */
  droppedClaims: DroppedClaim[];
}

export interface EvaluationContext {
  response: string;
  knownConcepts: ReadonlySet<string>;
  existingErrorIds: ReadonlySet<string>;
  closedAnswer: boolean;
  provider: string;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Validate a model's proposed evaluation. The model cannot write state; this function decides which
 * of its claims are supported enough to become mutations.
 */
export function validateEvaluation(raw: RawEvaluation, ctx: EvaluationContext): ValidatedEvaluation {
  const errors: ValidatedError[] = [];
  const droppedClaims: DroppedClaim[] = [];
  const seen = new Set<string>();

  for (const e of raw.errors) {
    const drop = (reason: string) => droppedClaims.push({ original: e.original, correction: e.correction, reason });
    if (!e.original.trim()) {
      drop("empty original fragment");
      continue;
    }
    if (!containsFragment(ctx.response, e.original)) {
      drop("original fragment not found in learner response");
      continue;
    }
    if (normalizeAnswer(e.original) === normalizeAnswer(e.correction)) {
      drop("correction identical to original");
      continue;
    }
    const dedupeKey = `${normalizeAnswer(e.original)}=>${normalizeAnswer(e.correction)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    errors.push({
      category: e.category,
      conceptKey: ctx.knownConcepts.has(e.concept) ? e.concept : null,
      original: e.original.trim(),
      correction: e.correction.trim(),
      explanation: e.explanation.trim(),
      hint: e.hint.trim(),
      existingErrorId: e.existing_error_id && ctx.existingErrorIds.has(e.existing_error_id) ? e.existing_error_id : null,
    });
  }

  const score = clamp01(raw.score);
  // For closed items, an answer with a validated error cannot be "correct", whatever the model said.
  const isCorrect = ctx.closedAnswer ? raw.is_correct && errors.length === 0 : raw.is_correct;

  return {
    source: "llm",
    provider: ctx.provider,
    isCorrect,
    score: ctx.closedAnswer ? (isCorrect ? Math.max(score, 0.9) : Math.min(score, 0.5)) : score,
    confidence: clamp01(raw.confidence),
    taskCompleted: raw.task_completed,
    feedbackSummary: raw.feedback_summary.trim(),
    errors,
    improvedVersion: raw.improved_version?.trim() || null,
    droppedClaims,
  };
}
