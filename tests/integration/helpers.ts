import { createDb, type Db } from "@/lib/db/client";
import { exercises, lessonSessions } from "@/lib/db/schema";
import type { ExerciseContent } from "@/lib/domain/exercise";
import { MockProvider } from "@/lib/llm/mock";
import type { AnalysisTools, AnalyzeRequest, GenerateRequest, LlmCallResult, LlmProvider } from "@/lib/llm/provider";
import type { GenerationOutput, RawEvaluation } from "@/lib/llm/schemas";
import { upsertProfile } from "@/lib/services/profile";

export const USER = "test-user";
export const T0 = new Date("2026-09-24T15:00:00Z");
export const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

export async function freshDb(): Promise<Db> {
  return createDb();
}

export const PROFILE = {
  displayName: "Test",
  examDate: "2026-12-15",
  weeklyHours: 5,
  preferredSessionMinutes: 30,
  nativeLanguages: ["Mandarin", "English"],
  frenchExperience: "Two years of evening classes",
  skillConfidence: { listening: 0.2, speaking: 0.1, reading: 0.4, writing: 0.3 },
};

export async function onboard(db: Db, userId = USER) {
  return upsertProfile(db, userId, PROFILE, T0);
}

/** Mock provider whose methods can be overridden per test. */
export class ScriptedProvider implements LlmProvider {
  readonly name = "mock" as const;
  readonly model = "scripted";
  private readonly mock = new MockProvider();
  analyze?: (req: AnalyzeRequest, tools: AnalysisTools) => Promise<LlmCallResult<RawEvaluation>>;
  generate?: (req: GenerateRequest) => Promise<LlmCallResult<GenerationOutput>>;
  analyzeCalls = 0;

  generateExercises(req: GenerateRequest) {
    return this.generate ? this.generate(req) : this.mock.generateExercises(req);
  }
  analyzeResponse(req: AnalyzeRequest, tools: AnalysisTools) {
    this.analyzeCalls++;
    return this.analyze ? this.analyze(req, tools) : this.mock.analyzeResponse(req, tools);
  }
}

export function evaluation(errors: Partial<RawEvaluation["errors"][number]>[], extra: Partial<RawEvaluation> = {}): LlmCallResult<RawEvaluation> {
  return {
    model: "scripted",
    usage: { inputTokens: 10, outputTokens: 5 },
    toolCalls: ["submit_evaluation"],
    output: {
      is_correct: errors.length === 0,
      score: errors.length ? 0.4 : 1,
      confidence: 0.8,
      task_completed: true,
      feedback_summary: "feedback",
      improved_version: null,
      errors: errors.map((e) => ({
        category: "grammar",
        concept: "pc_auxiliary",
        original: "",
        correction: "",
        explanation: "Use avoir.",
        hint: "Check the auxiliary.",
        existing_error_id: null,
        ...e,
      })),
      ...extra,
    },
  };
}

/** Insert a standalone session with hand-written exercises (bypasses the planner). */
export async function insertExercises(db: Db, items: { content: ExerciseContent; concept?: string | null; difficulty?: number }[], userId = USER) {
  const sessionId = crypto.randomUUID();
  await db.insert(lessonSessions).values({
    id: sessionId,
    userId,
    localDate: "2026-09-24",
    plannedMinutes: 15,
    status: "ready",
    plan: { minutes: 15, blocks: [{ type: "targeted_drill", minutes: 15, concepts: [], itemCount: items.length, rationale: "test" }] },
    plannerVersion: "test",
    createdAt: T0,
  });
  const ids: string[] = [];
  for (const [i, it] of items.entries()) {
    const id = crypto.randomUUID();
    ids.push(id);
    await db.insert(exercises).values({
      id,
      userId,
      sessionId,
      blockIndex: 0,
      position: i,
      type: it.content.type,
      skill: "writing",
      conceptKey: it.concept === undefined ? "pc_auxiliary" : it.concept,
      cefrLevel: "A2",
      difficulty: it.difficulty ?? 0.5,
      content: it.content,
      sourceType: "bank",
      createdAt: T0,
    });
  }
  return { sessionId, ids };
}
