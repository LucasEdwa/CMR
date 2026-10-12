-- Inside a workspace context only that workspace is visible. The cross-workspace view (a user's
-- own memberships, for the workspace switcher and login) is only available with no workspace set,
-- i.e. through withUser. Before this, queries in one workspace could also see the current user's
-- memberships in their other workspaces.
DROP POLICY tenants_select ON tenants;
--> statement-breakpoint
CREATE POLICY tenants_select ON tenants FOR SELECT USING (
  CASE WHEN app_current_tenant() IS NOT NULL
    THEN id = app_current_tenant()
    ELSE id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = app_current_user())
  END
);
--> statement-breakpoint
DROP POLICY memberships_select ON memberships;
--> statement-breakpoint
CREATE POLICY memberships_select ON memberships FOR SELECT USING (
  CASE WHEN app_current_tenant() IS NOT NULL
    THEN tenant_id = app_current_tenant()
    ELSE user_id = app_current_user()
  END
);
