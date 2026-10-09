export const SKILLS = ["listening", "speaking", "reading", "writing"] as const;
export type Skill = (typeof SKILLS)[number];

export type SkillConfidence = Record<Skill, number>;

export const SESSION_LENGTHS = [15, 30, 45] as const;
export type SessionLength = (typeof SESSION_LENGTHS)[number];

export type BlockType = "retrieval_review" | "targeted_drill" | "reading" | "writing" | "reflection";

export interface PlannedBlock {
  type: BlockType;
  minutes: number;
  /** Knowledge-point keys this block targets. */
  concepts: string[];
  /** Number of exercises (or review items) the block should contain. */
  itemCount: number;
  /** Human-readable reason the planner chose this block. */
  rationale: string;
  /** For retrieval_review blocks: the review items scheduled into the session. */
  reviewItemIds?: string[];
}

export interface SessionPlan {
  minutes: SessionLength;
  blocks: PlannedBlock[];
}

export const SESSION_STATUSES = ["ready", "in_progress", "completed", "abandoned"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
