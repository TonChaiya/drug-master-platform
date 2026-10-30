ALTER TABLE agent_installations
  ADD COLUMN last_heartbeat_at DATETIME(3) NULL,
  ADD COLUMN jhcis_connected TINYINT(1) NULL,
  ADD COLUMN last_jhcis_check_at DATETIME(3) NULL,
  ADD COLUMN ip_address VARCHAR(45) NULL,
  ADD COLUMN superseded_by_installation_id CHAR(36) NULL;

ALTER TABLE agent_enrollment_tokens
  ADD COLUMN target_installation_id CHAR(36) NULL;

ALTER TABLE agent_credentials
  ADD COLUMN superseded_by_credential_id CHAR(36) NULL;

CREATE INDEX idx_agent_enrollment_target ON agent_enrollment_tokens (target_installation_id);
CREATE INDEX idx_agent_credentials_superseded_by ON agent_credentials (superseded_by_credential_id);
