ALTER TABLE "errors" ADD COLUMN "context" text;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "exercise_type" text DEFAULT 'sentence_correction' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "instructions" text DEFAULT 'Corrigez la phrase.' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "accepted_answers" jsonb DEFAULT '[]'::jsonb NOT NULL;