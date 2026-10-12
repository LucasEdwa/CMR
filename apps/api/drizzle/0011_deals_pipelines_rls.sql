-- Standard tenant isolation for deals and pipelines.
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pipelines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON pipelines
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pipeline_stages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON pipeline_stages
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON deals
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE deal_contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deal_contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON deal_contacts
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deal_stage_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON deal_stage_history
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE picklist_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE picklist_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON picklist_items
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
