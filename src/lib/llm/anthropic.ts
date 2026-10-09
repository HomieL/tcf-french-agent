import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages";
import { z } from "zod";

import { ANALYZE_SYSTEM, GENERATE_SYSTEM, buildAnalyzePrompt, buildGeneratePrompt } from "./prompts";
import {
  LlmInvalidOutputError,
  LlmRefusalError,
  type AnalysisTools,
  type AnalyzeRequest,
  type GenerateRequest,
  type LlmCallResult,
  type LlmProvider,
  type LlmUsage,
} from "./provider";
import { EvaluationSchema, GenerationOutputSchema, type GenerationOutput, type RawEvaluation } from "./schemas";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicProviderOptions {
  client?: Anthropic;
  model?: string;
  generateEffort?: Effort;
  analyzeEffort?: Effort;
  /** Upper bound on model turns in the analysis tool loop. */
  maxAnalysisTurns?: number;
}

// Server-side refusal fallbacks: on a policy decline the API re-runs the request on a fallback model.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const SUBMIT_TOOL = "submit_evaluation";

/** JSON Schema for a strict tool: every object closed and every property required. */
export function strictJsonSchema(schema: z.ZodType): BetaTool["input_schema"] {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  const close = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "object" && n.properties) {
      n.additionalProperties = false;
      n.required = Object.keys(n.properties as object);
    }
    Object.values(n).forEach((v) => (Array.isArray(v) ? v.forEach(close) : close(v)));
  };
  close(json);
  return json as BetaTool["input_schema"];
}

export const ANALYSIS_TOOLS: BetaTool[] = [
  {
    name: "lookup_grammar_rule",
    description:
      "Look up the curated rule summary and examples for a knowledge-point key. Use it when you need the exact rule the app teaches for a concept.",
    input_schema: {
      type: "object",
      properties: { concept: { type: "string", description: "Knowledge-point key, e.g. pc_auxiliary" } },
      required: ["concept"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_learner_errors",
    description:
      "Return this learner's previously recorded errors for a concept (id, original, correction, failure_count). Use it to link a new error to an existing one when it is the same underlying mistake.",
    input_schema: {
      type: "object",
      properties: { concept: { type: "string", description: "Knowledge-point key" } },
      required: ["concept"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: SUBMIT_TOOL,
    description: "Submit the final evaluation of the learner's response. Call exactly once, as your last action.",
    input_schema: strictJsonSchema(EvaluationSchema),
    strict: true,
  },
];

function usageOf(msg: BetaMessage): LlmUsage {
  return {
    inputTokens:
      msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0),
    outputTokens: msg.usage.output_tokens,
  };
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };
}

function assertUsable(msg: BetaMessage): void {
  if (msg.stop_reason === "refusal") throw new LlmRefusalError("The model declined this request.");
  if (msg.stop_reason === "max_tokens") throw new LlmInvalidOutputError("Model output was truncated (max_tokens).", usageOf(msg));
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly generateEffort: Effort;
  private readonly analyzeEffort: Effort;
  private readonly maxAnalysisTurns: number;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.client = opts.client ?? new Anthropic();
    this.model = opts.model ?? "claude-opus-5";
    this.generateEffort = opts.generateEffort ?? "low";
    this.analyzeEffort = opts.analyzeEffort ?? "medium";
    this.maxAnalysisTurns = opts.maxAnalysisTurns ?? 6;
  }

  async generateExercises(req: GenerateRequest): Promise<LlmCallResult<GenerationOutput>> {
    const msg = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: this.generateEffort, format: betaZodOutputFormat(GenerationOutputSchema) },
      system: GENERATE_SYSTEM,
      messages: [{ role: "user", content: buildGeneratePrompt(req) }],
    });
    assertUsable(msg);
    if (!msg.parsed_output) throw new LlmInvalidOutputError("Generation output did not match the schema.", usageOf(msg));
    return { output: msg.parsed_output, model: msg.model, usage: usageOf(msg), toolCalls: [] };
  }

  async analyzeResponse(req: AnalyzeRequest, tools: AnalysisTools): Promise<LlmCallResult<RawEvaluation>> {
    const messages: BetaMessageParam[] = [{ role: "user", content: buildAnalyzePrompt(req) }];
    const toolCalls: string[] = [];
    let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
    let model = this.model;

    for (let turn = 0; turn < this.maxAnalysisTurns; turn++) {
      const msg = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: this.analyzeEffort },
        cache_control: { type: "ephemeral" },
        system: ANALYZE_SYSTEM,
        tools: ANALYSIS_TOOLS,
        tool_choice: { type: "auto" },
        messages,
      });
      usage = addUsage(usage, usageOf(msg));
      model = msg.model;
      assertUsable(msg);
      messages.push({ role: "assistant", content: msg.content });

      const toolUses = msg.content.filter((b) => b.type === "tool_use");
      if (toolUses.length === 0) {
        messages.push({ role: "user", content: `Call ${SUBMIT_TOOL} with your evaluation.` });
        continue;
      }

      const results: BetaToolResultBlockParam[] = [];
      for (const call of toolUses) {
        toolCalls.push(call.name);
        const input = call.input as Record<string, unknown>;
        if (call.name === SUBMIT_TOOL) {
          const parsed = EvaluationSchema.safeParse(input);
          if (parsed.success) return { output: parsed.data, model, usage, toolCalls };
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: `Invalid evaluation: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          });
          continue;
        }
        const concept = typeof input.concept === "string" ? input.concept : "";
        const result =
          call.name === "get_learner_errors"
            ? await tools.getLearnerErrors(concept)
            : call.name === "lookup_grammar_rule"
              ? await tools.lookupGrammarRule(concept)
              : { error: `Unknown tool ${call.name}` };
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: results });
    }
    throw new LlmInvalidOutputError(`No valid ${SUBMIT_TOOL} call within ${this.maxAnalysisTurns} turns.`, usage);
  }
}
