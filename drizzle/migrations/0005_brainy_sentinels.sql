ALTER TABLE "reward_rules" ADD COLUMN "effective_start" date;--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "effective_end" date;--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "supersedes_rule_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_rules" ADD CONSTRAINT "reward_rules_supersedes_rule_id_reward_rules_id_fk" FOREIGN KEY ("supersedes_rule_id") REFERENCES "public"."reward_rules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
