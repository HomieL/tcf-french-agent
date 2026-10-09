import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { ALL_BANK, DRILL_BANK, WRITING_BANK } from "@/lib/content/exercise-bank";
import { KNOWLEDGE_POINT_KEYS } from "@/lib/content/knowledge-points";
import { hasAcceptedAnswers, parseExerciseContent } from "@/lib/domain/exercise";
import { matchAcceptedAnswer } from "@/lib/domain/validation";
import { ANALYSIS_TOOLS, AnthropicProvider, strictJsonSchema } from "@/lib/llm/anthropic";
import { MockProvider } from "@/lib/llm/mock";
import { LlmInvalidOutputError, LlmRefusalError, type AnalysisTools, type AnalyzeRequest } from "@/lib/llm/provider";
import { EvaluationSchema, generatedToContent, validateEvaluation, type GeneratedExercise, type RawEvaluation } from "@/lib/llm/schemas";

describe("seed content integrity", () => {
  it("every bank item is valid content for a known concept", () => {
    for (const b of ALL_BANK) {
      expect(() => parseExerciseContent(b.content), b.id).not.toThrow();
      expect(KNOWLEDGE_POINT_KEYS.has(b.concept), b.id).toBe(true);
    }
    expect(new Set(ALL_BANK.map((b) => b.id)).size).toBe(ALL_BANK.length);
  });
  it("every accepted answer matches itself deterministically", () => {
    for (const b of ALL_BANK) {
      if (!hasAcceptedAnswers(b.content)) continue;
      for (const a of b.content.acceptedAnswers) expect(matchAcceptedAnswer(b.content, a), `${b.id}: ${a}`).toBe("exact");
    }
  });
  it("every grammar concept has at least two drill items; writing concepts exist", () => {
    const grammarConcepts = [...KNOWLEDGE_POINT_KEYS].filter((k) => !k.startsWith("reading_"));
    for (const k of grammarConcepts) expect(DRILL_BANK.filter((b) => b.concept === k).length, k).toBeGreaterThanOrEqual(2);
    for (const w of WRITING_BANK) expect(KNOWLEDGE_POINT_KEYS.has(w.concept)).toBe(true);
  });
});

function gen(overrides: Partial<GeneratedExercise>): GeneratedExercise {
  return {
    type: "fill_blank",
    cefr_level: "B1",
    difficulty: 0.5,
    instructions: "Complétez.",
    prompt: "Je ___ (vouloir) un café.",
    passage: null,
    accepted_answers: ["voudrais"],
    options: [],
    correct_option: null,
    min_words: null,
    max_words: null,
    required_elements: [],
    hint: null,
    ...overrides,
  };
}

describe("generatedToContent", () => {
  it("accepts well-formed items", () => {
    expect(generatedToContent(gen({})).type).toBe("fill_blank");
    const mcq = generatedToContent(gen({ type: "reading_mcq", passage: "Texte.", options: ["a", "b", "c"], correct_option: 2, accepted_answers: [] }));
    expect(mcq.type).toBe("reading_mcq");
  });
  it("rejects malformed items", () => {
    expect(() => generatedToContent(gen({ prompt: "No blank here." }))).toThrow();
    expect(() => generatedToContent(gen({ accepted_answers: [] }))).toThrow();
    expect(() => generatedToContent(gen({ type: "reading_mcq", passage: "T", options: ["a", "b"], correct_option: 5 }))).toThrow();
    expect(() => generatedToContent(gen({ type: "short_writing", min_words: 50, max_words: 20 }))).toThrow();
    expect(() => generatedToContent(gen({ type: "short_writing", min_words: null, max_words: null }))).toThrow();
  });
});

function raw(errors: Partial<RawEvaluation["errors"][number]>[], extra: Partial<RawEvaluation> = {}): RawEvaluation {
  return {
    is_correct: errors.length === 0,
    score: 0.5,
    confidence: 0.8,
    task_completed: true,
    feedback_summary: "ok",
    improved_version: null,
    errors: errors.map((e) => ({
      category: "grammar",
      concept: "pc_auxiliary",
      original: "je suis travaillé",
      correction: "j'ai travaillé",
      explanation: "avoir",
      hint: "auxiliaire",
      existing_error_id: null,
      ...e,
    })),
    ...extra,
  };
}

describe("validateEvaluation", () => {
  const ctx = {
    response: "Hier, je suis travaillé tard.",
    knownConcepts: new Set(["pc_auxiliary"]),
    existingErrorIds: new Set(["err-1"]),
    closedAnswer: false,
    provider: "test",
  };
  it("keeps supported errors and drops claims not grounded in the learner's text", () => {
    const v = validateEvaluation(raw([{}, { original: "nous avons allé", correction: "nous sommes allés" }]), ctx);
    expect(v.errors).toHaveLength(1);
    expect(v.droppedClaims).toEqual([expect.objectContaining({ reason: "original fragment not found in learner response" })]);
  });
  it("drops no-op corrections and duplicate errors", () => {
    const v = validateEvaluation(raw([{}, {}, { original: "tard", correction: "tard." }]), ctx);
    expect(v.errors).toHaveLength(1);
    expect(v.droppedClaims[0].reason).toBe("correction identical to original");
  });
  it("maps unknown concepts to null and only links error ids the model actually retrieved", () => {
    const v = validateEvaluation(raw([{ concept: "made_up", existing_error_id: "err-999" }]), ctx);
    expect(v.errors[0].conceptKey).toBeNull();
    expect(v.errors[0].existingErrorId).toBeNull();
    const linked = validateEvaluation(raw([{ existing_error_id: "err-1" }]), ctx);
    expect(linked.errors[0].existingErrorId).toBe("err-1");
  });
  it("clamps numbers and cannot mark a closed answer correct while reporting an error", () => {
    const v = validateEvaluation(raw([{}], { is_correct: true, score: 7, confidence: -2 }), { ...ctx, closedAnswer: true });
    expect(v.isCorrect).toBe(false);
    expect(v.score).toBeLessThanOrEqual(0.5);
    expect(v.confidence).toBe(0);
  });
});

describe("MockProvider heuristics", () => {
  const tools: AnalysisTools = {
    getLearnerErrors: async () => [],
    lookupGrammarRule: async () => ({ found: false }),
  };
  const writingReq = (response: string): AnalyzeRequest => ({
    exercise: { type: "short_writing", instructions: "", prompt: "", conceptKey: "pc_auxiliary", cefrLevel: "B1", requiredElements: [], minWords: 1, maxWords: 100 },
    response,
    nativeLanguages: ["zh"],
    knownConcepts: [],
  });
  it.each([
    ["Samedi, je suis travaillé au bureau.", "je suis travaillé", "j'ai travaillé"],
    ["Si j'aurais le temps, je voyagerais.", "si j'aurais", "si j'avais"],
    ["Si je pourrais, je viendrais.", "si je pourrais", "si je pouvais"],
    ["Il faut que tu fais attention.", "il faut que tu fais", "il faut que tu fasses"],
    ["Je ne mange pas de la viande.", "je ne mange pas de la ", "je ne mange pas de"],
  ])("flags %s", async (text, original, correction) => {
    const out = await new MockProvider().analyzeResponse(writingReq(text), tools);
    expect(out.output.errors[0].original.toLowerCase()).toBe(original.trim());
    expect(out.output.errors[0].correction.toLowerCase()).toBe(correction.trim());
  });
  it("reports no errors (with low confidence) on clean text", async () => {
    const out = await new MockProvider().analyzeResponse(writingReq("J'ai travaillé samedi."), tools);
    expect(out.output.errors).toHaveLength(0);
    expect(out.output.confidence).toBeLessThan(0.5);
  });
  it("links to an existing error with the same correction", async () => {
    const withHistory: AnalysisTools = {
      ...tools,
      getLearnerErrors: async () => [{ id: "e1", original: "x", correction: "j'ai travaillé", failure_count: 1 }],
    };
    const out = await new MockProvider().analyzeResponse(writingReq("Je suis travaillé."), withHistory);
    expect(out.output.errors[0].existing_error_id).toBe("e1");
    expect(out.toolCalls).toContain("get_learner_errors");
  });
});

// ---- Anthropic provider against a scripted fake client ----

type Block = Record<string, unknown>;
function message(content: Block[], stop_reason = "tool_use") {
  return { id: "m", model: "claude-opus-5", content, stop_reason, usage: { input_tokens: 100, output_tokens: 20 } };
}
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });

function fakeClient(script: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(structuredClone(params));
          const next = script.shift();
          if (!next) throw new Error("script exhausted");
          return next;
        },
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          return script.shift();
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const validEval = raw([{}]);
const analyzeReq: AnalyzeRequest = {
  exercise: { type: "sentence_correction", instructions: "", prompt: "Je suis travaillé.", conceptKey: "pc_auxiliary", cefrLevel: "A2", acceptedAnswers: ["J'ai travaillé."] },
  response: "Hier, je suis travaillé.",
  nativeLanguages: ["zh"],
  knownConcepts: [{ key: "pc_auxiliary", title: "PC" }],
};

describe("AnthropicProvider", () => {
  it("exposes strict, closed tool schemas", () => {
    const schema = strictJsonSchema(EvaluationSchema) as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(Object.keys(schema.properties as object));
    const errorItem = ((schema.properties as Record<string, { items: Record<string, unknown> }>).errors).items;
    expect(errorItem.additionalProperties).toBe(false);
    expect(ANALYSIS_TOOLS.every((t) => t.strict)).toBe(true);
  });

  it("runs the read-only tools, returns tool errors for invalid submissions, and accepts a valid one", async () => {
    const { client, calls } = fakeClient([
      message([toolUse("t1", "lookup_grammar_rule", { concept: "pc_auxiliary" }), toolUse("t2", "get_learner_errors", { concept: "pc_auxiliary" })]),
      message([toolUse("t3", "submit_evaluation", { is_correct: "nope" })]),
      message([toolUse("t4", "submit_evaluation", validEval)]),
    ]);
    const seen: string[] = [];
    const tools: AnalysisTools = {
      getLearnerErrors: async (c) => (seen.push(`errors:${c}`), []),
      lookupGrammarRule: async (c) => (seen.push(`rule:${c}`), { found: false }),
    };
    const out = await new AnthropicProvider({ client }).analyzeResponse(analyzeReq, tools);

    expect(out.output).toEqual(validEval);
    expect(out.toolCalls).toEqual(["lookup_grammar_rule", "get_learner_errors", "submit_evaluation", "submit_evaluation"]);
    expect(seen).toEqual(["rule:pc_auxiliary", "errors:pc_auxiliary"]);
    expect(out.usage).toEqual({ inputTokens: 300, outputTokens: 60 });

    // Parallel tool results go back in a single user message.
    const secondCall = calls[1].messages as { role: string; content: Block[] }[];
    const lastUser = secondCall[secondCall.length - 1];
    expect(lastUser.content.map((b) => b.tool_use_id)).toEqual(["t1", "t2"]);
    // The invalid submission is returned as an error tool_result.
    const thirdCall = calls[2].messages as { role: string; content: Block[] }[];
    expect(thirdCall[thirdCall.length - 1].content[0]).toMatchObject({ tool_use_id: "t3", is_error: true });
    // Request shape: model, fallbacks, adaptive thinking.
    expect(calls[0]).toMatchObject({ model: "claude-opus-5", fallbacks: "default", thinking: { type: "adaptive" } });
  });

  it("nudges the model when it answers without calling a tool", async () => {
    const { client, calls } = fakeClient([
      message([{ type: "text", text: "Looks wrong." }], "end_turn"),
      message([toolUse("t1", "submit_evaluation", validEval)]),
    ]);
    const tools: AnalysisTools = { getLearnerErrors: async () => [], lookupGrammarRule: async () => ({ found: false }) };
    await new AnthropicProvider({ client }).analyzeResponse(analyzeReq, tools);
    const msgs = calls[1].messages as { role: string; content: unknown }[];
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "Call submit_evaluation with your evaluation." });
  });

  it("surfaces refusals and gives up after the turn budget", async () => {
    const tools: AnalysisTools = { getLearnerErrors: async () => [], lookupGrammarRule: async () => ({ found: false }) };
    const refused = fakeClient([message([], "refusal")]);
    await expect(new AnthropicProvider({ client: refused.client }).analyzeResponse(analyzeReq, tools)).rejects.toBeInstanceOf(LlmRefusalError);

    const looping = fakeClient([
      message([toolUse("a", "get_learner_errors", { concept: "x" })]),
      message([toolUse("b", "get_learner_errors", { concept: "x" })]),
    ]);
    await expect(
      new AnthropicProvider({ client: looping.client, maxAnalysisTurns: 2 }).analyzeResponse(analyzeReq, tools),
    ).rejects.toBeInstanceOf(LlmInvalidOutputError);
  });

  it("generates with structured output and rejects unparseable or truncated output", async () => {
    const good = fakeClient([{ ...message([], "end_turn"), parsed_output: { exercises: [gen({})] } }]);
    const out = await new AnthropicProvider({ client: good.client }).generateExercises({
      concept: { key: "k", title: "t", cefrLevel: "B1", ruleSummary: "r", examples: [] },
      count: 1,
      types: ["fill_blank"],
      learnerMastery: 0.4,
      recentErrors: [],
      avoidPrompts: [],
    });
    expect(out.output.exercises).toHaveLength(1);
    expect(good.calls[0]).toMatchObject({ output_config: { effort: "low" } });

    const req = { concept: { key: "k", title: "t", cefrLevel: "B1", ruleSummary: "r", examples: [] }, count: 1, types: ["fill_blank" as const], learnerMastery: 0.4, recentErrors: [], avoidPrompts: [] };
    const bad = fakeClient([{ ...message([], "end_turn"), parsed_output: null }]);
    await expect(new AnthropicProvider({ client: bad.client }).generateExercises(req)).rejects.toBeInstanceOf(LlmInvalidOutputError);
    const cut = fakeClient([{ ...message([], "max_tokens"), parsed_output: null }]);
    await expect(new AnthropicProvider({ client: cut.client }).generateExercises(req)).rejects.toBeInstanceOf(LlmInvalidOutputError);
  });
});
