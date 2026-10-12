-- Tenant context helpers. NULLIF matters: once a pooled connection has had app.tenant_id set,
-- current_setting returns '' (not NULL) in later transactions, and ''::uuid would throw.
-- With NULLIF, a missing context compares as NULL and policies return zero rows (fail closed).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- tenants: visible when it is the current tenant or the current user is a member (workspace switcher).
-- Writes only within the current tenant context.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenants_select ON tenants FOR SELECT USING (
  id = app_current_tenant()
  OR id IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = app_current_user())
);
--> statement-breakpoint
CREATE POLICY tenants_insert ON tenants FOR INSERT WITH CHECK (id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY tenants_update ON tenants FOR UPDATE
  USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY tenants_delete ON tenants FOR DELETE USING (id = app_current_tenant());
--> statement-breakpoint

-- memberships: a user also sees their own memberships in other tenants (workspace switcher).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_select ON memberships FOR SELECT USING (
  tenant_id = app_current_tenant() OR user_id = app_current_user()
);
--> statement-breakpoint
CREATE POLICY memberships_insert ON memberships FOR INSERT WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY memberships_update ON memberships FOR UPDATE
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY memberships_delete ON memberships FOR DELETE USING (tenant_id = app_current_tenant());
--> statement-breakpoint

-- audit_log: standard tenant isolation.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint

-- Grants. The app connects as app_user: no DDL, no BYPASSRLS.
GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_tenant(), app_current_user() TO app_user;
--> statement-breakpoint
-- Tables created by later migrations (run by this same owner role) get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
--> statement-breakpoint
-- The audit log is append-only for the app.
REVOKE UPDATE, DELETE ON audit_log FROM app_user;
