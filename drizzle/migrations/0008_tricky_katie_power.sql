CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"issuer_id" uuid NOT NULL,
	"card_id" uuid,
	"campaign_name" text NOT NULL,
	"campaign_type" text NOT NULL,
	"requires_registration" boolean DEFAULT false NOT NULL,
	"registration_channel" text,
	"registration_deadline" date,
	"effective_start" date NOT NULL,
	"effective_end" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "welcome_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"card_id" uuid NOT NULL,
	"offer_name" text NOT NULL,
	"offer_type" text NOT NULL,
	"tiers" jsonb NOT NULL,
	"estimated_value_hkd" numeric(14, 2),
	"estimation_note" text,
	"application_channel" text,
	"new_customer_only" boolean DEFAULT false NOT NULL,
	"existing_customer_restriction_note" text,
	"annual_fee_required" boolean DEFAULT false NOT NULL,
	"requires_apply_with_code" text,
	"effective_start" date,
	"effective_end" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"confidence_score" numeric(4, 3) DEFAULT '0.500' NOT NULL,
	"source_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "welcome_offers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "welcome_offers_approved_must_have_source" CHECK ("welcome_offers"."status" <> 'approved' OR "welcome_offers"."source_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "reward_rules" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_issuer_id_issuers_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."issuers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_source_id_source_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "welcome_offers" ADD CONSTRAINT "welcome_offers_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "welcome_offers" ADD CONSTRAINT "welcome_offers_source_id_source_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_rules" ADD CONSTRAINT "reward_rules_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
