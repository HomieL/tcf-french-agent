import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "@/lib/db/client";
import { knowledgePoints, learnerProfiles, masteryStates } from "@/lib/db/schema";
import { priorFromConfidence } from "@/lib/domain/mastery";
import type { Skill } from "@/lib/domain/types";
import { BadRequestError } from "@/lib/errors";

const confidence = z.number().min(0).max(1);

export const ProfileInputSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  examDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  weeklyHours: z.number().int().min(1).max(40),
  preferredSessionMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]),
  nativeLanguages: z.array(z.string().trim().min(1).max(40)).min(1).max(5),
  frenchExperience: z.string().trim().max(500),
  skillConfidence: z.object({ listening: confidence, speaking: confidence, reading: confidence, writing: confidence }),
});
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export async function getProfile(db: Db, userId: string) {
  const [row] = await db.select().from(learnerProfiles).where(eq(learnerProfiles.userId, userId));
  return row ?? null;
}

/**
 * Create or update the learner profile. On creation, mastery priors are initialized for every
 * knowledge point from the self-rated confidence of the matching skill; updates never reset mastery.
 */
export async function upsertProfile(db: Db, userId: string, input: unknown, now = new Date()) {
  const parsed = ProfileInputSchema.safeParse(input);
  if (!parsed.success) throw new BadRequestError("Invalid profile", z.flattenError(parsed.error));
  const p = parsed.data;

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(learnerProfiles).where(eq(learnerProfiles.userId, userId));
    if (existing) {
      await tx
        .update(learnerProfiles)
        .set({ ...p, updatedAt: now })
        .where(eq(learnerProfiles.userId, userId));
    } else {
      await tx.insert(learnerProfiles).values({ userId, ...p, createdAt: now, updatedAt: now });
      const kps = await tx.select({ key: knowledgePoints.key, skill: knowledgePoints.skill }).from(knowledgePoints);
      await tx.insert(masteryStates).values(
        kps.map((k) => ({
          userId,
          conceptKey: k.key,
          ...priorFromConfidence(p.skillConfidence[k.skill as Skill] ?? 0.2),
          evidenceCount: 0,
          updatedAt: now,
        })),
      );
    }
    const [row] = await tx.select().from(learnerProfiles).where(eq(learnerProfiles.userId, userId));
    return row;
  });
}
