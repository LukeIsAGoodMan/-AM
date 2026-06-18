ALTER TABLE "reward_rules" ADD COLUMN "applies_to" text[];--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "stacking_policy" text DEFAULT 'additive' NOT NULL;--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "exclusive_group" text;--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "priority" integer DEFAULT 100 NOT NULL;