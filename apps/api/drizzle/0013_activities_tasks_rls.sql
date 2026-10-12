-- Standard tenant isolation for activities, their links and tasks.
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON activities
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE activity_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON activity_links
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tasks
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint

-- notifications: tenant isolation, and only the recipient reads, marks or deletes one.
-- Anyone in the workspace may notify a member of the same workspace (assignments, @mentions).
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY notifications_read ON notifications AS RESTRICTIVE FOR SELECT
  USING (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY notifications_insert ON notifications AS RESTRICTIVE FOR INSERT
  WITH CHECK (user_id IN (SELECT m.user_id FROM memberships m WHERE m.tenant_id = app_current_tenant()));
--> statement-breakpoint
CREATE POLICY notifications_update ON notifications AS RESTRICTIVE FOR UPDATE
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY notifications_delete ON notifications AS RESTRICTIVE FOR DELETE
  USING (user_id = app_current_user());
--> statement-breakpoint
-- The recipient can only mark a notification read, never rewrite it.
REVOKE UPDATE ON notifications FROM app_user;
--> statement-breakpoint
GRANT UPDATE (read_at) ON notifications TO app_user;
