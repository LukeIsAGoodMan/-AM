CREATE TABLE IF NOT EXISTS "source_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "extracted_text" text;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "extraction_method" text;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "extraction_failed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "extraction_error" text;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "retrieved_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_source_id_source_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
