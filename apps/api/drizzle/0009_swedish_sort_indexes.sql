DROP INDEX "companies_tenant_name_idx";--> statement-breakpoint
DROP INDEX "contacts_tenant_name_idx";--> statement-breakpoint
CREATE INDEX "companies_tenant_name_idx" ON "companies" USING btree ("tenant_id",lower("name") collate "sv-x-icu");--> statement-breakpoint
CREATE INDEX "contacts_tenant_name_idx" ON "contacts" USING btree ("tenant_id",lower("last_name") collate "sv-x-icu",lower("first_name") collate "sv-x-icu");