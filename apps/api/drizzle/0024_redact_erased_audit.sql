-- The audit log is append-only for app_user. When a record is erased for good (Trash purge), its
-- before/after values in the log are personal data that must go too. This function clears them, and
-- only for a record that no longer exists, in the current workspace, called by an owner, admin or
-- the system role (who see every record, so "no longer exists" is reliable). The audit events
-- themselves (who, what, when) stay.
CREATE FUNCTION app_redact_erased_audit(p_entity_type text, p_entity_id uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  n integer;
BEGIN
  IF app_current_tenant() IS NULL OR NOT app_can_manage() THEN
    RETURN 0;
  END IF;
  IF (p_entity_type = 'contact' AND EXISTS (SELECT 1 FROM contacts WHERE id = p_entity_id))
    OR (p_entity_type = 'company' AND EXISTS (SELECT 1 FROM companies WHERE id = p_entity_id))
    OR (p_entity_type = 'deal' AND EXISTS (SELECT 1 FROM deals WHERE id = p_entity_id))
    OR (p_entity_type = 'activity' AND EXISTS (SELECT 1 FROM activities WHERE id = p_entity_id))
    OR (p_entity_type = 'task' AND EXISTS (SELECT 1 FROM tasks WHERE id = p_entity_id))
    OR p_entity_type NOT IN ('contact', 'company', 'deal', 'activity', 'task') THEN
    RETURN 0;
  END IF;
  UPDATE audit_log SET diff = NULL
    WHERE tenant_id = app_current_tenant() AND entity_type = p_entity_type AND entity_id = p_entity_id AND diff IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_redact_erased_audit(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_redact_erased_audit(text, uuid) TO app_user;
