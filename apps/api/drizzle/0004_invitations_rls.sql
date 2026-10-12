ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON invitations
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
