-- Atlas — Initial Schema Migration
-- Run this once against a fresh PostgreSQL database:
--   psql -U postgres -d atlas -f 001_init.sql
--
-- Create the DB first if it doesn't exist:
--   createdb -U postgres atlas

-- ── Tenants ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL,
    email        VARCHAR(255) NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── API Keys ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_hash   VARCHAR(64)  NOT NULL UNIQUE,  -- SHA-256 hex digest of the raw key
    key_prefix VARCHAR(16)  NOT NULL,          -- first 16 chars for identification
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys(tenant_id);

-- ── Usage Logs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id VARCHAR(36)   NOT NULL,
    url        VARCHAR(2048),
    command    TEXT,
    action     VARCHAR(16),   -- click | fill | scroll | focus
    element_id VARCHAR(255),
    timestamp  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant_id  ON usage_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_session_id ON usage_logs(session_id);

-- ── Error Logs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS error_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url        VARCHAR(2048) NOT NULL,
    element_id VARCHAR(255),
    error_type VARCHAR(64)   NOT NULL,  -- missing_alt | missing_aria | missing_label
    suggestion TEXT,
    flagged_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_tenant_id ON error_logs(tenant_id);
