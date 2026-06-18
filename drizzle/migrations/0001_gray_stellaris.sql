CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_zh" text,
	"parent_category_id" uuid,
	"description_en" text,
	"description_zh" text,
	"example_merchants" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "is_online" boolean;--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "is_overseas" boolean;--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "is_foreign_currency" boolean;--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "cap_amount_hkd" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "cap_reward_amount" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "cap_period" text;--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "cap_basis" text;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "card_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_category_id_categories_id_fk" FOREIGN KEY ("parent_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_rules" ADD CONSTRAINT "reward_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
