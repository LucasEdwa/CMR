-- Standard tenant isolation for imports and the records they touched.
ALTER TABLE imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE imports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON imports
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE import_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE import_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON import_records
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint

-- recent_views: tenant isolation, and each user only sees and writes their own list.
ALTER TABLE recent_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recent_views FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON recent_views
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY recent_views_own ON recent_views AS RESTRICTIVE
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
