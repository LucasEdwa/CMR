-- Workspaces are erased by a background job after the grace period, with the system role.
DROP POLICY role_delete ON tenants;
--> statement-breakpoint
CREATE POLICY role_delete ON tenants AS RESTRICTIVE FOR DELETE USING (app_current_role() IN ('owner', 'system'));
