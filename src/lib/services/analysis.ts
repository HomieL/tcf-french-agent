import { eq } from "drizzle-orm";

import type { Tx } from "@/lib/db/client";
import { knowledgePoints } from "@/lib/db/schema";
import type { ExerciseContent } from "@/lib/domain/exercise";
import type { AnalysisTools, AnalyzeRequest, LlmProvider } from "@/lib/llm/provider";
import { PROMPT_VERSIONS } from "@/lib/llm/prompts";
import { validateEvaluation, type ValidatedEvaluation } from "@/lib/llm/schemas";
import { recentErrorsForConcept } from "./learner-state";
import { annotateModelRun, runModel, type ModelPurpose } from "./telemetry";

/**
 * Read-only tools exposed to the model. `linkableErrorIds` records every error id the model has
 * actually retrieved: it may only link a new mistake to an error it has seen for this learner.
 */
export function makeAnalysisTools(db: Tx, userId: string) {
  const linkableErrorIds = new Set<string>();
  const tools: AnalysisTools = {
    async getLearnerErrors(concept) {
      const rows = await recentErrorsForConcept(db, userId, concept, 20);
      rows.forEach((r) => linkableErrorIds.add(r.id));
      return rows;
    },
    async lookupGrammarRule(concept) {
      const [kp] = await db.select().from(knowledgePoints).where(eq(knowledgePoints.key, concept));
      if (!kp) return { found: false };
      return { found: true, title: kp.title, rule: kp.ruleSummary, examples: kp.examples, provenance: kp.provenance };
    },
  };
  return { tools, linkableErrorIds };
}

export type AnalysisOutcome =
  | { ok: true; evaluation: ValidatedEvaluation; modelRunId: string }
  | { ok: false; modelRunId: string; message: string };

export async function analyzeWithModel(
  db: Tx,
  provider: LlmProvider,
  userId: string,
  purpose: ModelPurpose,
  input: {
    content: ExerciseContent;
    conceptKey: string | null;
    cefrLevel: string;
    response: string;
    nativeLanguages: string[];
  },
): Promise<AnalysisOutcome> {
  const kps = await db.select({ key: knowledgePoints.key, title: knowledgePoints.title }).from(knowledgePoints);
  const { content } = input;
  const request: AnalyzeRequest = {
    exercise: {
      type: content.type,
      instructions: content.instructions,
      prompt: content.type === "reading_mcq" ? `${content.passage}\n\n${content.prompt}` : content.prompt,
      conceptKey: input.conceptKey,
      cefrLevel: input.cefrLevel,
      ...("acceptedAnswers" in content ? { acceptedAnswers: content.acceptedAnswers } : {}),
      ...(content.type === "short_writing"
        ? { requiredElements: content.requiredElements, minWords: content.minWords, maxWords: content.maxWords }
        : {}),
    },
    response: input.response,
    nativeLanguages: input.nativeLanguages,
    knownConcepts: kps,
  };

  const { tools, linkableErrorIds } = makeAnalysisTools(db, userId);
  const run = await runModel(db, { userId, purpose, provider, promptVersion: PROMPT_VERSIONS.analyze }, () =>
    provider.analyzeResponse(request, tools),
  );
  if (!run.ok) {
    return {
      ok: false,
      modelRunId: run.runId,
      message:
        run.status === "refusal"
          ? "The evaluator declined to assess this response."
          : "Automatic evaluation failed. Your answer was saved; please try submitting again.",
    };
  }

  const evaluation = validateEvaluation(run.result.output, {
    response: input.response,
    knownConcepts: new Set(kps.map((k) => k.key)),
    existingErrorIds: linkableErrorIds,
    closedAnswer: "acceptedAnswers" in content,
    provider: `${provider.name}:${run.result.model}`,
  });
  if (evaluation.droppedClaims.length > 0) {
    await annotateModelRun(db, run.runId, { unsupportedClaims: evaluation.droppedClaims.length });
  }
  return { ok: true, evaluation, modelRunId: run.runId };
}
