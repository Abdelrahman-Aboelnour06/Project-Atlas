-- Atlas — Row Level Security (RLS) Migration
-- Run this against the database to enforce multi-tenant isolation at the DB engine layer:
--   psql -U postgres -d atlas -f 002_enable_rls.sql

-- 1. Enable RLS on all tenant-isolated tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- 2. Create tenant isolation policies based on current_setting('app.current_tenant_id', true)
CREATE POLICY tenant_isolation_policy_api_keys ON api_keys
    FOR ALL
    USING (
        current_setting('app.current_tenant_id', true) IS NULL
        OR tenant_id::text = current_setting('app.current_tenant_id', true)
    );

CREATE POLICY tenant_isolation_policy_usage_logs ON usage_logs
    FOR ALL
    USING (
        current_setting('app.current_tenant_id', true) IS NULL
        OR tenant_id::text = current_setting('app.current_tenant_id', true)
    );

CREATE POLICY tenant_isolation_policy_error_logs ON error_logs
    FOR ALL
    USING (
        current_setting('app.current_tenant_id', true) IS NULL
        OR tenant_id::text = current_setting('app.current_tenant_id', true)
    );

CREATE POLICY tenant_isolation_policy_tenants ON tenants
    FOR ALL
    USING (
        current_setting('app.current_tenant_id', true) IS NULL
        OR id::text = current_setting('app.current_tenant_id', true)
    );
