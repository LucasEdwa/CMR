CREATE TYPE "public"."import_mode" AS ENUM('skip', 'update');--> statement-breakpoint
CREATE TYPE "public"."import_object" AS ENUM('contacts', 'companies', 'deals');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('queued', 'running', 'done', 'failed', 'undone');--> statement-breakpoint
CREATE TYPE "public"."record_type" AS ENUM('contact', 'company', 'deal');--> statement-breakpoint
CREATE TABLE "import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"record_type" "record_type" NOT NULL,
	"record_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"object" "import_object" NOT NULL,
	"file_name" text NOT NULL,
	"mode" "import_mode" NOT NULL,
	"status" "import_status" DEFAULT 'queued' NOT NULL,
	"header" jsonb NOT NULL,
	"mapping" jsonb NOT NULL,
	"source" text,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	CONSTRAINT "imports_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "recent_views" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"record_type" "record_type" NOT NULL,
	"record_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recent_views_tenant_id_user_id_record_type_record_id_pk" PRIMARY KEY("tenant_id","user_id","record_type","record_id")
);
--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_tenant_id_import_id_imports_tenant_id_id_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."imports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_views" ADD CONSTRAINT "recent_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_views" ADD CONSTRAINT "recent_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_records_import_idx" ON "import_records" USING btree ("tenant_id","import_id");--> statement-breakpoint
CREATE INDEX "imports_tenant_created_idx" ON "imports" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recent_views_user_idx" ON "recent_views" USING btree ("tenant_id","user_id","viewed_at" DESC NULLS LAST);