import { and, desc, eq } from "drizzle-orm";

import type { Tx } from "@/lib/db/client";
import { exercises, knowledgePoints, masteryStates } from "@/lib/db/schema";
import { ALL_BANK } from "@/lib/content/exercise-bank";
import type { ExerciseContent, ExerciseType } from "@/lib/domain/exercise";
import { summarize } from "@/lib/domain/mastery";
import { normalizeAnswer } from "@/lib/domain/text";
import type { LlmProvider } from "@/lib/llm/provider";
import { PROMPT_VERSIONS } from "@/lib/llm/prompts";
import { generatedToContent } from "@/lib/llm/schemas";
import { recentErrorsForConcept } from "./learner-state";
import { annotateModelRun, runModel } from "./telemetry";

export interface PreparedExercise {
  conceptKey: string;
  content: ExerciseContent;
  cefrLevel: string;
  difficulty: number;
  sourceType: "generated" | "bank";
  bankId: string | null;
  modelRunId: string | null;
  promptVersion: string | null;
}

/**
 * Produce `count` exercises for one concept. Generated items that fail validation are dropped
 * individually and replaced from the seed bank, so one malformed item never fails the whole session.
 */
export async function prepareExercises(
  db: Tx,
  provider: LlmProvider,
  userId: string,
  opts: { conceptKey: string; count: number; types: ExerciseType[] },
): Promise<PreparedExercise[]> {
  const [kp] = await db.select().from(knowledgePoints).where(eq(knowledgePoints.key, opts.conceptKey));
  if (!kp) throw new Error(`Unknown concept ${opts.conceptKey}`);

  const [mastery] = await db
    .select()
    .from(masteryStates)
    .where(and(eq(masteryStates.userId, userId), eq(masteryStates.conceptKey, kp.key)));
  const recent = await recentErrorsForConcept(db, userId, kp.key, 5);
  const previous = await db
    .select({ content: exercises.content })
    .from(exercises)
    .where(and(eq(exercises.userId, userId), eq(exercises.conceptKey, kp.key)))
    .orderBy(desc(exercises.createdAt))
    .limit(30);
  const avoidPrompts = previous.map((p) => p.content.prompt);
  const seen = new Set(avoidPrompts.map(normalizeAnswer));

  const out: PreparedExercise[] = [];
  const run = await runModel(
    db,
    { userId, purpose: "generate_exercises", provider, promptVersion: PROMPT_VERSIONS.generate },
    () =>
      provider.generateExercises({
        concept: { key: kp.key, title: kp.title, cefrLevel: kp.cefrLevel, ruleSummary: kp.ruleSummary, examples: kp.examples },
        count: opts.count,
        types: opts.types,
        learnerMastery: mastery ? summarize(mastery).mean : 0.3,
        recentErrors: recent.map((r) => ({ original: r.original, correction: r.correction })),
        avoidPrompts,
      }),
  );

  if (run.ok) {
    let invalid = 0;
    for (const g of run.result.output.exercises) {
      if (out.length >= opts.count) break;
      try {
        const content = generatedToContent(g);
        if (!(opts.types as string[]).includes(content.type)) throw new Error(`type ${content.type} not requested`);
        const key = normalizeAnswer(content.prompt);
        if (seen.has(key) && provider.name !== "mock") throw new Error("duplicate prompt");
        seen.add(key);
        out.push({
          conceptKey: kp.key,
          content,
          cefrLevel: g.cefr_level,
          difficulty: Math.min(1, Math.max(0, g.difficulty)),
          // Mock "generation" only re-serves bank items: never label them as model-generated.
          sourceType: provider.name === "mock" ? "bank" : "generated",
          bankId: null,
          modelRunId: run.runId,
          promptVersion: PROMPT_VERSIONS.generate,
        });
      } catch {
        invalid++;
      }
    }
    if (invalid > 0) await annotateModelRun(db, run.runId, { note: `${invalid} generated item(s) failed validation` });
  }

  // Per-item fallback from the bank (unseen items first).
  if (out.length < opts.count) {
    const used = new Set(out.map((o) => normalizeAnswer(o.content.prompt)));
    const bank = ALL_BANK.filter((b) => b.concept === kp.key && (opts.types as string[]).includes(b.content.type));
    const ordered = [
      ...bank.filter((b) => !seen.has(normalizeAnswer(b.content.prompt))),
      ...bank.filter((b) => seen.has(normalizeAnswer(b.content.prompt))),
    ];
    for (const b of ordered) {
      if (out.length >= opts.count) break;
      if (used.has(normalizeAnswer(b.content.prompt))) continue;
      used.add(normalizeAnswer(b.content.prompt));
      out.push({
        conceptKey: kp.key,
        content: b.content,
        cefrLevel: b.cefrLevel,
        difficulty: b.difficulty,
        sourceType: "bank",
        bankId: b.id,
        modelRunId: null,
        promptVersion: null,
      });
    }
  }
  return out;
}
