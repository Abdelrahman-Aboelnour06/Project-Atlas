-- 003_security_events.sql
-- Table for recording client secret leak prevention events (defense-in-depth safety net)

CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    session_id VARCHAR(36) NOT NULL,
    category VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE policyname = 'tenant_isolation_policy_security_events' 
          AND tablename = 'security_events'
    ) THEN
        CREATE POLICY tenant_isolation_policy_security_events ON security_events
            FOR ALL
            USING (
                current_setting('app.current_tenant_id', true) IS NULL
                OR tenant_id::text = current_setting('app.current_tenant_id', true)
            );
    END IF;
END $$;
