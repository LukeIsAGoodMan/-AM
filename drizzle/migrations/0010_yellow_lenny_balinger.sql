CREATE TABLE IF NOT EXISTS "cross_check_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"claim_type" text NOT NULL,
	"key_dimension" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"canonical_payload" jsonb,
	"aggregate_confidence" numeric(4, 3) DEFAULT '0.000' NOT NULL,
	"supporting_claim_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"contradicting_claim_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"approved_rule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"claims_emitted" integer DEFAULT 0 NOT NULL,
	"cost_usd_cents" integer,
	"latency_ms" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_type" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"card_id" uuid NOT NULL,
	"subject_claim_id" uuid,
	"subject_group_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reward_rule_sources" (
	"rule_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"supporting_claim_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_rule_sources_rule_id_source_id_pk" PRIMARY KEY("rule_id","source_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"claim_type" text NOT NULL,
	"structured_payload" jsonb NOT NULL,
	"extracted_text_snippet" text NOT NULL,
	"extraction_run_id" uuid,
	"extracted_by" text NOT NULL,
	"confidence_score" numeric(4, 3) DEFAULT '0.500' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"cross_check_group_id" uuid,
	"reviewer_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cross_check_groups" ADD CONSTRAINT "cross_check_groups_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cross_check_groups" ADD CONSTRAINT "cross_check_groups_approved_rule_id_reward_rules_id_fk" FOREIGN KEY ("approved_rule_id") REFERENCES "public"."reward_rules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_source_id_source_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_subject_claim_id_source_claims_id_fk" FOREIGN KEY ("subject_claim_id") REFERENCES "public"."source_claims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_subject_group_id_cross_check_groups_id_fk" FOREIGN KEY ("subject_group_id") REFERENCES "public"."cross_check_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_rule_sources" ADD CONSTRAINT "reward_rule_sources_rule_id_reward_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."reward_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_rule_sources" ADD CONSTRAINT "reward_rule_sources_source_id_source_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_rule_sources" ADD CONSTRAINT "reward_rule_sources_supporting_claim_id_source_claims_id_fk" FOREIGN KEY ("supporting_claim_id") REFERENCES "public"."source_claims"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_claims" ADD CONSTRAINT "source_claims_source_id_source_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_claims" ADD CONSTRAINT "source_claims_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_claims" ADD CONSTRAINT "source_claims_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_claims" ADD CONSTRAINT "source_claims_cross_check_group_id_cross_check_groups_id_fk" FOREIGN KEY ("cross_check_group_id") REFERENCES "public"."cross_check_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cross_check_groups_unique_dim" ON "cross_check_groups" USING btree ("card_id","claim_type","key_dimension");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cross_check_groups_status_idx" ON "cross_check_groups" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extraction_runs_source_id_idx" ON "extraction_runs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extraction_runs_started_at_idx" ON "extraction_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_tasks_status_priority_idx" ON "review_tasks" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_tasks_card_id_idx" ON "review_tasks" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_rule_sources_source_id_idx" ON "reward_rule_sources" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_claims_card_id_claim_type_idx" ON "source_claims" USING btree ("card_id","claim_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_claims_status_idx" ON "source_claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_claims_group_id_idx" ON "source_claims" USING btree ("cross_check_group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_claims_source_id_idx" ON "source_claims" USING btree ("source_id");