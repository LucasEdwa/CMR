CREATE TYPE "public"."activity_type" AS ENUM('note', 'call', 'meeting', 'email');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('connected', 'no_answer', 'voicemail', 'busy', 'wrong_number');--> statement-breakpoint
CREATE TYPE "public"."email_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('task_assigned', 'task_reminder', 'mention');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "activity_type" NOT NULL,
	"subject" text,
	"body" jsonb,
	"body_text" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_minutes" integer,
	"outcome" "call_outcome",
	"direction" "email_direction",
	"pinned" boolean DEFAULT false NOT NULL,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "activity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	CONSTRAINT "activity_links_one_record" CHECK (num_nonnulls("activity_links"."contact_id", "activity_links"."company_id", "activity_links"."deal_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"actor_user_id" uuid,
	"data" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_date" date NOT NULL,
	"due_time" time,
	"due_at" timestamp with time zone NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"assignee_user_id" uuid,
	"contact_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"reminder_sent_for" date,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "tasks_one_record" CHECK (num_nonnulls("tasks"."contact_id", "tasks"."company_id", "tasks"."deal_id") <= 1)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_tenant_id_activity_id_activities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","activity_id") REFERENCES "public"."activities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_tenant_id_company_id_companies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_links" ADD CONSTRAINT "activity_links_tenant_id_deal_id_deals_tenant_id_id_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."deals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_company_id_companies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_deal_id_deals_tenant_id_id_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."deals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_tenant_occurred_idx" ON "activities" USING btree ("tenant_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_links_activity_idx" ON "activity_links" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_links_contact_idx" ON "activity_links" USING btree ("tenant_id","contact_id","activity_id") WHERE "activity_links"."contact_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_links_company_idx" ON "activity_links" USING btree ("tenant_id","company_id","activity_id") WHERE "activity_links"."company_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_links_deal_idx" ON "activity_links" USING btree ("tenant_id","deal_id","activity_id") WHERE "activity_links"."deal_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tasks_assignee_open_idx" ON "tasks" USING btree ("tenant_id","assignee_user_id","due_at") WHERE "tasks"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_assignee_done_idx" ON "tasks" USING btree ("tenant_id","assignee_user_id","completed_at" DESC NULLS LAST) WHERE "tasks"."completed_at" is not null;--> statement-breakpoint
CREATE INDEX "tasks_contact_idx" ON "tasks" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "tasks_company_idx" ON "tasks" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "tasks_deal_idx" ON "tasks" USING btree ("tenant_id","deal_id","due_at");