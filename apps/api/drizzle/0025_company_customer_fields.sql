CREATE TYPE "public"."customer_type" AS ENUM('company', 'private');--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "customer_type" "customer_type" DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "trade_name" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_street" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_postal_code" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_city" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_email" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "delivery_street" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "delivery_postal_code" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "delivery_city" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "fortnox_customer_number" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "payment_term_days" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "credit_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "credit_limit" bigint;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "discount" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "discount_sale" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "discount_rental" numeric(5, 2);--> statement-breakpoint
CREATE INDEX "companies_tenant_fortnox_idx" ON "companies" USING btree ("tenant_id","fortnox_customer_number");