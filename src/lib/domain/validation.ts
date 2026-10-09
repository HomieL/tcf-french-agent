import type { ExerciseContent } from "./exercise";
import { countWords, normalizeAnswer, stripAccents } from "./text";

export interface ValidationCheck {
  name: string;
  passed: boolean;
  /** block: the attempt is returned to the learner; warn: recorded but evaluation continues. */
  severity: "block" | "warn";
  detail: string;
}

export interface DeterministicValidation {
  ok: boolean;
  wordCount: number;
  checks: ValidationCheck[];
}

const MAX_CHARS = 3000;

/** Step 1 of evaluation: deterministic checks that never need a model. */
export function validateResponse(content: ExerciseContent, response: string): DeterministicValidation {
  const text = response.trim();
  const wordCount = countWords(text);
  const checks: ValidationCheck[] = [];

  checks.push({ name: "non_empty", passed: text.length > 0, severity: "block", detail: "Response must not be empty." });
  checks.push({
    name: "max_length",
    passed: text.length <= MAX_CHARS,
    severity: "block",
    detail: `Response must be at most ${MAX_CHARS} characters.`,
  });

  switch (content.type) {
    case "reading_mcq": {
      const idx = Number(text);
      checks.push({
        name: "option_selected",
        passed: Number.isInteger(idx) && idx >= 0 && idx < content.options.length,
        severity: "block",
        detail: "Choose one of the options.",
      });
      break;
    }
    case "short_writing":
      checks.push({
        name: "min_words",
        passed: wordCount >= content.minWords,
        severity: "block",
        detail: `Write at least ${content.minWords} words (currently ${wordCount}).`,
      });
      checks.push({
        name: "max_words",
        passed: wordCount <= content.maxWords,
        severity: "warn",
        detail: `Aim for at most ${content.maxWords} words (currently ${wordCount}).`,
      });
      break;
    case "reflection":
      checks.push({ name: "min_words", passed: wordCount >= 3, severity: "block", detail: "Write at least a short sentence." });
      break;
    case "fill_blank":
      checks.push({
        name: "short_answer",
        passed: text.length <= Math.max(200, content.prompt.length * 2),
        severity: "block",
        detail: "Type only the missing word(s) or the completed sentence.",
      });
      break;
    default:
      break;
  }

  const ok = checks.every((c) => c.passed || c.severity === "warn");
  return { ok, wordCount, checks };
}

export type AnswerMatch = "exact" | "accent_only" | "none";

/**
 * Deterministic comparison against accepted answers. An exact match skips the model entirely.
 * For fill_blank, the learner may type either the missing words or the full sentence.
 */
export function matchAcceptedAnswer(
  content: Extract<ExerciseContent, { acceptedAnswers: string[] }>,
  response: string,
): AnswerMatch {
  const candidates = new Set<string>();
  for (const a of content.acceptedAnswers) {
    candidates.add(normalizeAnswer(a));
    if (content.type === "fill_blank") candidates.add(normalizeAnswer(content.prompt.replace("___", a)));
  }
  const r = normalizeAnswer(response);
  if (candidates.has(r)) return "exact";
  const rNoAccent = stripAccents(r);
  for (const c of candidates) if (stripAccents(c) === rNoAccent) return "accent_only";
  return "none";
}
