import type { ExerciseType } from "@/lib/domain/exercise";
import type { GenerationOutput, RawEvaluation } from "./schemas";

export interface ConceptContext {
  key: string;
  title: string;
  cefrLevel: string;
  ruleSummary: string;
  examples: string[];
}

export interface GenerateRequest {
  concept: ConceptContext;
  count: number;
  types: ExerciseType[];
  learnerMastery: number;
  recentErrors: { original: string; correction: string }[];
  avoidPrompts: string[];
}

export interface AnalyzeRequest {
  exercise: {
    type: ExerciseType;
    instructions: string;
    prompt: string;
    conceptKey: string | null;
    cefrLevel: string;
    acceptedAnswers?: string[];
    requiredElements?: string[];
    minWords?: number;
    maxWords?: number;
  };
  response: string;
  nativeLanguages: string[];
  knownConcepts: { key: string; title: string }[];
}

export interface LearnerErrorSummary {
  id: string;
  original: string;
  correction: string;
  failure_count: number;
}

/** Read-only tools the model may call during analysis. None of them mutate state. */
export interface AnalysisTools {
  getLearnerErrors(concept: string): Promise<LearnerErrorSummary[]>;
  lookupGrammarRule(
    concept: string,
  ): Promise<{ found: true; title: string; rule: string; examples: string[]; provenance: string } | { found: false }>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCallResult<T> {
  output: T;
  model: string;
  usage: LlmUsage;
  toolCalls: string[];
}

export interface LlmProvider {
  readonly name: "anthropic" | "mock";
  readonly model: string;
  generateExercises(req: GenerateRequest): Promise<LlmCallResult<GenerationOutput>>;
  analyzeResponse(req: AnalyzeRequest, tools: AnalysisTools): Promise<LlmCallResult<RawEvaluation>>;
}

export class LlmRefusalError extends Error {}
export class LlmInvalidOutputError extends Error {
  constructor(
    message: string,
    readonly usage: LlmUsage = { inputTokens: 0, outputTokens: 0 },
  ) {
    super(message);
  }
}
