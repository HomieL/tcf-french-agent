import { ALL_BANK } from "@/lib/content/exercise-bank";
import type { ExerciseContent } from "@/lib/domain/exercise";
import { normalizeAnswer, stripAccents } from "@/lib/domain/text";
import type { AnalysisTools, AnalyzeRequest, GenerateRequest, LlmCallResult, LlmProvider } from "./provider";
import type { GeneratedExercise, GenerationOutput, RawEvaluation } from "./schemas";

/**
 * Deterministic stand-in for the model. It serves bank items as "generated" exercises and performs a
 * shallow, rule-based analysis. Its feedback is labeled low-confidence: it exists so the app and the
 * test suite run without an API key, not to judge French.
 */
export class MockProvider implements LlmProvider {
  readonly name = "mock" as const;
  readonly model = "mock-v1";

  async generateExercises(req: GenerateRequest): Promise<LlmCallResult<GenerationOutput>> {
    const avoid = new Set(req.avoidPrompts.map(normalizeAnswer));
    const candidates = ALL_BANK.filter(
      (b) => b.concept === req.concept.key && (req.types as string[]).includes(b.content.type),
    );
    const fresh = candidates.filter((b) => !avoid.has(normalizeAnswer(b.content.prompt)));
    const picked = [...fresh, ...candidates.filter((b) => !fresh.includes(b))].slice(0, req.count);
    return {
      output: { exercises: picked.map((b) => toGenerated(b.content, b.cefrLevel, b.difficulty)) },
      model: this.model,
      usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: [],
    };
  }

  async analyzeResponse(req: AnalyzeRequest, tools: AnalysisTools): Promise<LlmCallResult<RawEvaluation>> {
    const toolCalls: string[] = [];
    const concept = req.exercise.conceptKey ?? "other";
    const response = req.response.trim();
    const errors: RawEvaluation["errors"] = [];

    if (req.exercise.acceptedAnswers?.length) {
      const expected = req.exercise.acceptedAnswers[0];
      const accentOnly = req.exercise.acceptedAnswers.some(
        (a) => stripAccents(normalizeAnswer(a)) === stripAccents(normalizeAnswer(response)),
      );
      toolCalls.push("lookup_grammar_rule");
      const rule = await tools.lookupGrammarRule(accentOnly ? "orthographe_accents" : concept);
      errors.push({
        category: accentOnly ? "spelling" : "grammar",
        concept: accentOnly ? "orthographe_accents" : concept,
        original: response,
        correction: expected,
        explanation: rule.found ? rule.rule : "Compare your answer with the expected one.",
        hint: accentOnly ? "Check the accents." : "Review the rule for this concept.",
        existing_error_id: null,
      });
    } else {
      errors.push(...heuristicWritingErrors(response));
    }

    for (const e of errors) {
      toolCalls.push("get_learner_errors");
      const existing = await tools.getLearnerErrors(e.concept);
      const same = existing.find((x) => normalizeAnswer(x.correction) === normalizeAnswer(e.correction));
      if (same) e.existing_error_id = same.id;
    }
    toolCalls.push("submit_evaluation");

    const isWriting = req.exercise.type === "short_writing";
    return {
      output: {
        is_correct: errors.length === 0,
        score: errors.length === 0 ? (isWriting ? 0.7 : 1) : isWriting ? 0.5 : 0,
        confidence: isWriting ? 0.2 : 0.6,
        task_completed: true,
        feedback_summary: isWriting
          ? "Mock evaluator: only a few common patterns are checked. Add an ANTHROPIC_API_KEY for real writing feedback."
          : errors.length === 0
            ? "Correct."
            : "Your answer differs from the expected answer.",
        errors,
        improved_version: null,
      },
      model: this.model,
      usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls,
    };
  }
}

// Unicode-aware word boundaries: \b treats accented letters such as "é" as non-word characters.
const B = "(?<![\\p{L}])";
const E = "(?![\\p{L}])";

const AVOIR_PARTICIPLES = "travaillé|mangé|fini|parlé|regardé|acheté|visité|étudié|joué|fait|pris|vu|eu|été";

const WRITING_RULES: { pattern: RegExp; concept: string; fix: (m: RegExpMatchArray) => string; explanation: string }[] = [
  {
    pattern: new RegExp(`${B}(je suis|tu es|il est|elle est|on est|nous sommes|vous êtes|ils sont|elles sont) (${AVOIR_PARTICIPLES})${E}`, "iu"),
    concept: "pc_auxiliary",
    fix: (m) => `${avoirFor(m[1])} ${m[2]}`,
    explanation: "This verb forms the passé composé with avoir, not être.",
  },
  {
    pattern: new RegExp(`${B}si (j'|je |tu )(aurais|serais|pourrais|voudrais|irais|ferais)${E}`, "iu"),
    concept: "si_clauses",
    fix: (m) => {
      const verb = IMPARFAIT[m[2].toLowerCase()];
      const subject = m[1] === "tu " ? "tu " : /^[aeéiou]/.test(verb) ? "j'" : "je ";
      return `si ${subject}${verb}`;
    },
    explanation: "After si, use the imparfait (not the conditional).",
  },
  {
    pattern: new RegExp(`${B}il faut que (je|tu|il|elle|on) (est|es|va|vas|peut|peux|fait|fais|a|as)${E}`, "iu"),
    concept: "subjonctif_present",
    fix: (m) => `il faut que ${m[1]} ${SUBJ[m[2].toLowerCase()] ?? m[2]}`,
    explanation: "Il faut que is followed by the subjunctive.",
  },
  {
    pattern: new RegExp(`${B}(je|tu|il|elle|on|nous|vous|ils|elles) (?:ne|n') ?\\p{L}+ pas (du|de la|des) `, "iu"),
    concept: "articles_partitifs",
    fix: (m) => m[0].replace(/ (du|de la|des) $/i, " de "),
    explanation: "After a negation, du / de la / des become de.",
  },
];

const IMPARFAIT: Record<string, string> = { aurais: "avais", serais: "étais", pourrais: "pouvais", voudrais: "voulais", irais: "allais", ferais: "faisais" };

const SUBJ: Record<string, string> = { est: "soit", es: "sois", va: "aille", vas: "ailles", peut: "puisse", peux: "puisses", fait: "fasse", fais: "fasses", a: "ait", as: "aies" };

function avoirFor(subject: string): string {
  const map: Record<string, string> = {
    "je suis": "j'ai",
    "tu es": "tu as",
    "il est": "il a",
    "elle est": "elle a",
    "on est": "on a",
    "nous sommes": "nous avons",
    "vous êtes": "vous avez",
    "ils sont": "ils ont",
    "elles sont": "elles ont",
  };
  return map[subject.toLowerCase()] ?? subject;
}

function heuristicWritingErrors(text: string): RawEvaluation["errors"] {
  const out: RawEvaluation["errors"] = [];
  for (const rule of WRITING_RULES) {
    const m = text.match(rule.pattern);
    if (!m) continue;
    out.push({
      category: "grammar",
      concept: rule.concept,
      original: m[0].trim(),
      correction: rule.fix(m).trim(),
      explanation: rule.explanation,
      hint: "Check the verb form here.",
      existing_error_id: null,
    });
  }
  return out;
}

function toGenerated(c: ExerciseContent, cefr: GeneratedExercise["cefr_level"], difficulty: number): GeneratedExercise {
  const base: GeneratedExercise = {
    type: c.type === "reflection" ? "short_writing" : c.type,
    cefr_level: cefr,
    difficulty,
    instructions: c.instructions,
    prompt: c.prompt,
    passage: null,
    accepted_answers: [],
    options: [],
    correct_option: null,
    min_words: null,
    max_words: null,
    required_elements: [],
    hint: c.hint ?? null,
  };
  if ("acceptedAnswers" in c) base.accepted_answers = c.acceptedAnswers;
  if (c.type === "reading_mcq") Object.assign(base, { passage: c.passage, options: c.options, correct_option: c.correctOption });
  if (c.type === "short_writing")
    Object.assign(base, { min_words: c.minWords, max_words: c.maxWords, required_elements: c.requiredElements });
  return base;
}
