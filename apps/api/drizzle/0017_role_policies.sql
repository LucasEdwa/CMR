-- Roles in RLS, under the API's own role checks. app.role is set transaction-locally by withTenant.
-- 'system' is server-side work the app starts itself after its own checks (default pipelines and
-- picklists, accepting a verified invitation, background jobs); it never comes from a request.
CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.role', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_can_write() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(app_current_role() IN ('owner', 'admin', 'member', 'system'), false) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_can_manage() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(app_current_role() IN ('owner', 'admin', 'system'), false) $$;
--> statement-breakpoint
-- Owners and admins see every record; others only their own when the workspace turned that on.
CREATE OR REPLACE FUNCTION app_sees_all_records() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_can_manage() OR NOT coalesce((SELECT own_records_only FROM tenants WHERE id = app_current_tenant()), false) $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_role(), app_can_write(), app_can_manage(), app_sees_all_records() TO app_user;
--> statement-breakpoint

-- CRM records: viewers read, everyone else writes. Restrictive, so they AND with tenant isolation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies', 'contacts', 'tags', 'contact_tags', 'company_tags', 'deals', 'deal_contacts',
    'deal_stage_history', 'activities', 'activity_links', 'tasks', 'imports', 'import_records']
  LOOP
    EXECUTE format('CREATE POLICY role_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (app_can_write())', t);
    EXECUTE format('CREATE POLICY role_update ON %I AS RESTRICTIVE FOR UPDATE USING (app_can_write()) WITH CHECK (app_can_write())', t);
    EXECUTE format('CREATE POLICY role_delete ON %I AS RESTRICTIVE FOR DELETE USING (app_can_write())', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Workspace setup: owners and admins only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pipelines', 'pipeline_stages', 'picklist_items', 'invitations']
  LOOP
    EXECUTE format('CREATE POLICY role_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (app_can_manage())', t);
    EXECUTE format('CREATE POLICY role_update ON %I AS RESTRICTIVE FOR UPDATE USING (app_can_manage()) WITH CHECK (app_can_manage())', t);
    EXECUTE format('CREATE POLICY role_delete ON %I AS RESTRICTIVE FOR DELETE USING (app_can_manage())', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- The workspace itself: admins change settings, only owners delete it.
CREATE POLICY role_update ON tenants AS RESTRICTIVE FOR UPDATE USING (app_can_manage()) WITH CHECK (app_can_manage());
--> statement-breakpoint
CREATE POLICY role_delete ON tenants AS RESTRICTIVE FOR DELETE USING (app_current_role() = 'owner');
--> statement-breakpoint

-- Memberships: managers add and change people; anyone may leave (delete their own membership).
CREATE POLICY role_insert ON memberships AS RESTRICTIVE FOR INSERT WITH CHECK (app_can_manage());
--> statement-breakpoint
CREATE POLICY role_update ON memberships AS RESTRICTIVE FOR UPDATE USING (app_can_manage()) WITH CHECK (app_can_manage());
--> statement-breakpoint
CREATE POLICY role_delete ON memberships AS RESTRICTIVE FOR DELETE USING (app_can_manage() OR user_id = app_current_user());
--> statement-breakpoint

-- "Own records only" for contacts, companies and deals (reads and writes).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies', 'contacts', 'deals']
  LOOP
    EXECUTE format('CREATE POLICY own_records ON %I AS RESTRICTIVE
      USING (app_sees_all_records() OR owner_user_id = app_current_user())
      WITH CHECK (app_sees_all_records() OR owner_user_id = app_current_user())', t);
  END LOOP;
END $$;
