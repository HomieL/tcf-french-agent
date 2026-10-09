import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import type { LlmProvider } from "./provider";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

let cached: LlmProvider | undefined;

/**
 * LLM_PROVIDER=mock forces the mock. Otherwise the Anthropic provider is used when a key is
 * configured, falling back to the mock so the app still runs locally without credentials.
 */
export function getProvider(): LlmProvider {
  if (cached) return cached;
  const forced = process.env.LLM_PROVIDER;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  cached =
    forced === "mock" || (!hasKey && forced !== "anthropic")
      ? new MockProvider()
      : new AnthropicProvider({
          model: process.env.ANTHROPIC_MODEL || undefined,
          generateEffort: (process.env.GENERATE_EFFORT as Effort) || undefined,
          analyzeEffort: (process.env.ANALYZE_EFFORT as Effort) || undefined,
        });
  return cached;
}

/** USD per million tokens (input, output). Unknown models are recorded at 0 and flagged in the UI. */
const PRICING: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  return (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000;
}

export type { LlmProvider } from "./provider";
