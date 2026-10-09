import { z } from "zod";

export const EXERCISE_TYPES = [
  "fill_blank",
  "translation",
  "sentence_correction",
  "reading_mcq",
  "short_writing",
  "reflection",
] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;

/**
 * Stored exercise content. One flat shape per type keeps storage simple; `parseExerciseContent`
 * enforces the per-type invariants so malformed generated content never reaches the learner.
 */
const base = {
  instructions: z.string().min(1),
  prompt: z.string().min(1),
  hint: z.string().nullable().optional(),
};

export const ExerciseContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("fill_blank"),
    ...base,
    acceptedAnswers: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("translation"),
    ...base,
    acceptedAnswers: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("sentence_correction"),
    ...base,
    acceptedAnswers: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("reading_mcq"),
    ...base,
    passage: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(5),
    correctOption: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("short_writing"),
    ...base,
    minWords: z.number().int().min(1),
    maxWords: z.number().int().min(1),
    requiredElements: z.array(z.string()),
  }),
  z.object({
    type: z.literal("reflection"),
    ...base,
  }),
]);
export type ExerciseContent = z.infer<typeof ExerciseContentSchema>;

export class InvalidExerciseError extends Error {}

export function parseExerciseContent(input: unknown): ExerciseContent {
  const parsed = ExerciseContentSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidExerciseError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const c = parsed.data;
  if (c.type === "fill_blank" && !c.prompt.includes("___")) {
    throw new InvalidExerciseError("fill_blank prompt must contain a ___ blank");
  }
  if (c.type === "reading_mcq" && c.correctOption >= c.options.length) {
    throw new InvalidExerciseError("reading_mcq correctOption out of range");
  }
  if (c.type === "short_writing" && c.minWords > c.maxWords) {
    throw new InvalidExerciseError("short_writing minWords > maxWords");
  }
  return c;
}

export function hasAcceptedAnswers(
  c: ExerciseContent,
): c is Extract<ExerciseContent, { acceptedAnswers: string[] }> {
  return "acceptedAnswers" in c;
}

/** Content sent to the browser: never includes answers. */
export function toPublicContent(c: ExerciseContent) {
  switch (c.type) {
    case "fill_blank":
    case "translation":
    case "sentence_correction":
      return { type: c.type, instructions: c.instructions, prompt: c.prompt, hint: c.hint ?? null };
    case "reading_mcq":
      return {
        type: c.type,
        instructions: c.instructions,
        prompt: c.prompt,
        hint: c.hint ?? null,
        passage: c.passage,
        options: c.options,
      };
    case "short_writing":
      return {
        type: c.type,
        instructions: c.instructions,
        prompt: c.prompt,
        hint: c.hint ?? null,
        minWords: c.minWords,
        maxWords: c.maxWords,
        requiredElements: c.requiredElements,
      };
    case "reflection":
      return { type: c.type, instructions: c.instructions, prompt: c.prompt, hint: c.hint ?? null };
  }
}
export type PublicExerciseContent = ReturnType<typeof toPublicContent>;
