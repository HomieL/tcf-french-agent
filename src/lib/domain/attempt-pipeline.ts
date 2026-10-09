import type { DeterministicValidation } from "./validation";

/**
 * Deterministic state machine for processing one learner response. The application owns every
 * transition; the model only ever runs inside the `analyzing` state and returns a proposal.
 */
export const ATTEMPT_STATES = [
  "received",
  "rejected",
  "validated",
  "matched",
  "analyzing",
  "analyzed",
  "analysis_failed",
  "applied",
  "recorded",
] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

const TRANSITIONS: Record<AttemptState, readonly AttemptState[]> = {
  received: ["validated", "rejected"],
  validated: ["matched", "analyzing", "recorded"],
  analyzing: ["analyzed", "analysis_failed"],
  matched: ["applied"],
  analyzed: ["applied"],
  rejected: [],
  analysis_failed: [],
  applied: [],
  recorded: [],
};

export const TERMINAL_ATTEMPT_STATES: readonly AttemptState[] = ["rejected", "analysis_failed", "applied", "recorded"];

export interface PipelineTraceEntry {
  state: AttemptState;
  at: string;
  note?: string;
}

export type ValidationResult = DeterministicValidation;

export class IllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal transition ${from} -> ${to}`);
  }
}

export class AttemptPipeline {
  private current: AttemptState = "received";
  readonly trace: PipelineTraceEntry[];

  constructor(private readonly clock: () => Date = () => new Date()) {
    this.trace = [{ state: "received", at: clock().toISOString() }];
  }

  get state(): AttemptState {
    return this.current;
  }

  get isTerminal(): boolean {
    return TERMINAL_ATTEMPT_STATES.includes(this.current);
  }

  transition(to: AttemptState, note?: string): void {
    if (!TRANSITIONS[this.current].includes(to)) throw new IllegalTransitionError(this.current, to);
    this.current = to;
    this.trace.push({ state: to, at: this.clock().toISOString(), ...(note ? { note } : {}) });
  }
}

/** Session lifecycle. */
const SESSION_TRANSITIONS: Record<string, readonly string[]> = {
  ready: ["in_progress", "abandoned", "completed"],
  in_progress: ["completed", "abandoned"],
  completed: [],
  abandoned: [],
};

export function assertSessionTransition(from: string, to: string): void {
  if (from === to) return;
  if (!SESSION_TRANSITIONS[from]?.includes(to)) throw new IllegalTransitionError(from, to);
}
