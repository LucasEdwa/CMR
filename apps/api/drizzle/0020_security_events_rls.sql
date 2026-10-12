-- security_events: each user reads only their own. The API records events without a user
-- context (during login), so inserts are open; nobody can change or delete an event.
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE security_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY security_events_read ON security_events FOR SELECT USING (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY security_events_insert ON security_events FOR INSERT WITH CHECK (true);
--> statement-breakpoint
REVOKE UPDATE, DELETE ON security_events FROM app_user;
