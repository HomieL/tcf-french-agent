import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";

import { KNOWLEDGE_POINTS, KNOWLEDGE_POINT_PROVENANCE } from "@/lib/content/knowledge-points";
import { knowledgePoints } from "./schema";

/** Idempotent upsert of reference content (curated knowledge points). */
export async function seedReferenceData(db: PgliteDatabase<Record<string, unknown>>): Promise<void> {
  await db
    .insert(knowledgePoints)
    .values(
      KNOWLEDGE_POINTS.map((k) => ({
        key: k.key,
        title: k.title,
        category: k.category,
        skill: k.skill,
        cefrLevel: k.cefrLevel,
        ruleSummary: k.ruleSummary,
        examples: k.examples,
        sourceType: "curated",
        provenance: KNOWLEDGE_POINT_PROVENANCE,
        version: 1,
      })),
    )
    .onConflictDoUpdate({
      target: knowledgePoints.key,
      set: {
        title: sql`excluded.title`,
        category: sql`excluded.category`,
        skill: sql`excluded.skill`,
        cefrLevel: sql`excluded.cefr_level`,
        ruleSummary: sql`excluded.rule_summary`,
        examples: sql`excluded.examples`,
        provenance: sql`excluded.provenance`,
      },
    });
}
