import { eq } from "drizzle-orm";

import type { Tx } from "@/lib/db/client";
import { modelRuns } from "@/lib/db/schema";
import { estimateCostUsd } from "@/lib/llm";
import { LlmInvalidOutputError, LlmRefusalError, type LlmCallResult, type LlmProvider } from "@/lib/llm/provider";

export type ModelPurpose = "generate_exercises" | "analyze_response" | "analyze_review";

export type ModelRunOutcome<T> =
  | { ok: true; runId: string; result: LlmCallResult<T>; latencyMs: number }
  | { ok: false; runId: string; error: Error; status: "invalid_output" | "refusal" | "error" };

/**
 * Run one model call and record it in model_runs (latency, tokens, cost, tool calls, outcome).
 * Failures are recorded too, then returned rather than thrown so callers can fall back.
 */
export async function runModel<T>(
  db: Tx,
  opts: { userId: string; purpose: ModelPurpose; provider: LlmProvider; promptVersion: string },
  call: () => Promise<LlmCallResult<T>>,
  clock: () => number = () => performance.now(),
): Promise<ModelRunOutcome<T>> {
  const runId = crypto.randomUUID();
  const started = clock();
  try {
    const result = await call();
    const latencyMs = Math.round(clock() - started);
    await db.insert(modelRuns).values({
      id: runId,
      userId: opts.userId,
      purpose: opts.purpose,
      provider: opts.provider.name,
      model: result.model,
      promptVersion: opts.promptVersion,
      status: "ok",
      latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: estimateCostUsd(result.model, result.usage.inputTokens, result.usage.outputTokens),
      toolCalls: result.toolCalls,
    });
    return { ok: true, runId, result, latencyMs };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const status = err instanceof LlmRefusalError ? "refusal" : err instanceof LlmInvalidOutputError ? "invalid_output" : "error";
    const usage = err instanceof LlmInvalidOutputError ? err.usage : { inputTokens: 0, outputTokens: 0 };
    await db.insert(modelRuns).values({
      id: runId,
      userId: opts.userId,
      purpose: opts.purpose,
      provider: opts.provider.name,
      model: opts.provider.model,
      promptVersion: opts.promptVersion,
      status,
      latencyMs: Math.round(clock() - started),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: estimateCostUsd(opts.provider.model, usage.inputTokens, usage.outputTokens),
      errorMessage: error.message.slice(0, 500),
    });
    return { ok: false, runId, error, status };
  }
}

export async function annotateModelRun(
  db: Tx,
  runId: string,
  patch: { unsupportedClaims?: number; note?: string },
): Promise<void> {
  await db
    .update(modelRuns)
    .set({
      ...(patch.unsupportedClaims !== undefined ? { unsupportedClaims: patch.unsupportedClaims } : {}),
      ...(patch.note ? { errorMessage: patch.note } : {}),
    })
    .where(eq(modelRuns.id, runId));
}
