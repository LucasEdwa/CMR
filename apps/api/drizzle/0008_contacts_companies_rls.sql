-- Standard tenant isolation for every CRM table.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON companies
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON contacts
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tags FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tags
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contact_tags FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON contact_tags
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE company_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_tags FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON company_tags
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- saved_views: tenant isolation. Everyone reads shared views and their own; only the owner
-- creates, changes or deletes a view.
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON saved_views
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY views_read ON saved_views AS RESTRICTIVE FOR SELECT
  USING (shared OR owner_user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY views_insert ON saved_views AS RESTRICTIVE FOR INSERT
  WITH CHECK (owner_user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY views_update ON saved_views AS RESTRICTIVE FOR UPDATE
  USING (owner_user_id = app_current_user()) WITH CHECK (owner_user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY views_delete ON saved_views AS RESTRICTIVE FOR DELETE
  USING (owner_user_id = app_current_user());
