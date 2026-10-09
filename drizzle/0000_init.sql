CREATE TABLE "attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exercise_id" text,
	"review_item_id" text,
	"session_id" text,
	"parent_attempt_id" text,
	"response" text NOT NULL,
	"latency_ms" integer,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"pipeline_trace" jsonb NOT NULL,
	"validation" jsonb,
	"evaluation" jsonb,
	"evaluation_source" text DEFAULT 'none' NOT NULL,
	"is_correct" boolean,
	"score" double precision,
	"confidence" double precision,
	"model_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_occurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"error_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"original" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"block_index" integer NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"skill" text NOT NULL,
	"concept_key" text,
	"cefr_level" text NOT NULL,
	"difficulty" double precision NOT NULL,
	"content" jsonb NOT NULL,
	"source_type" text NOT NULL,
	"bank_id" text,
	"model_run_id" text,
	"prompt_version" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_points" (
	"key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"skill" text NOT NULL,
	"cefr_level" text NOT NULL,
	"rule_summary" text NOT NULL,
	"examples" jsonb NOT NULL,
	"source_type" text DEFAULT 'curated' NOT NULL,
	"provenance" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "errors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"concept_key" text,
	"original" text NOT NULL,
	"correction" text NOT NULL,
	"explanation" text NOT NULL,
	"hint" text,
	"fingerprint" text NOT NULL,
	"failure_count" integer DEFAULT 1 NOT NULL,
	"success_streak" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"first_attempt_id" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"target_exam" text DEFAULT 'tcf_canada' NOT NULL,
	"target_nclc" integer DEFAULT 7 NOT NULL,
	"exam_date" text,
	"weekly_hours" integer NOT NULL,
	"preferred_session_minutes" integer NOT NULL,
	"native_languages" jsonb NOT NULL,
	"french_experience" text NOT NULL,
	"skill_confidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"planned_minutes" integer NOT NULL,
	"status" text NOT NULL,
	"plan" jsonb NOT NULL,
	"planner_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mastery_states" (
	"user_id" text NOT NULL,
	"concept_key" text NOT NULL,
	"alpha" double precision NOT NULL,
	"beta" double precision NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mastery_states_user_id_concept_key_pk" PRIMARY KEY("user_id","concept_key")
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unsupported_claims" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"error_id" text NOT NULL,
	"concept_key" text,
	"prompt" text NOT NULL,
	"answer" text NOT NULL,
	"explanation" text NOT NULL,
	"card" jsonb NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"review_item_id" text NOT NULL,
	"attempt_id" text,
	"rating" integer NOT NULL,
	"previous_due" timestamp with time zone NOT NULL,
	"next_due" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_model_run_id_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_occurrences" ADD CONSTRAINT "error_occurrences_error_id_errors_id_fk" FOREIGN KEY ("error_id") REFERENCES "public"."errors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_occurrences" ADD CONSTRAINT "error_occurrences_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_session_id_lesson_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lesson_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_concept_key_knowledge_points_key_fk" FOREIGN KEY ("concept_key") REFERENCES "public"."knowledge_points"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_model_run_id_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errors" ADD CONSTRAINT "errors_concept_key_knowledge_points_key_fk" FOREIGN KEY ("concept_key") REFERENCES "public"."knowledge_points"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_states" ADD CONSTRAINT "mastery_states_concept_key_knowledge_points_key_fk" FOREIGN KEY ("concept_key") REFERENCES "public"."knowledge_points"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_error_id_errors_id_fk" FOREIGN KEY ("error_id") REFERENCES "public"."errors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_review_item_id_review_items_id_fk" FOREIGN KEY ("review_item_id") REFERENCES "public"."review_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempts_user_idx" ON "attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "attempts_exercise_idx" ON "attempts" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "exercises_session_idx" ON "exercises" USING btree ("session_id","block_index","position");--> statement-breakpoint
CREATE UNIQUE INDEX "errors_user_fingerprint_idx" ON "errors" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "lesson_sessions_user_date_idx" ON "lesson_sessions" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "model_runs_user_idx" ON "model_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_error_idx" ON "review_items" USING btree ("error_id");--> statement-breakpoint
CREATE INDEX "review_items_due_idx" ON "review_items" USING btree ("user_id","due");