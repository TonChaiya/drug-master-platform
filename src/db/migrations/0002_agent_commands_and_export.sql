CREATE TABLE agent_commands (
  id CHAR(36) NOT NULL,
  facility_id CHAR(36) NOT NULL,
  installation_id CHAR(36) NULL,
  command_type VARCHAR(32) NOT NULL,
  payload_json JSON NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  idempotency_key VARCHAR(96) NOT NULL,
  claim_token CHAR(36) NULL,
  claimed_installation_id CHAR(36) NULL,
  requested_by CHAR(36) NULL,
  result_code VARCHAR(48) NULL,
  result_message VARCHAR(500) NULL,
  expires_at DATETIME(3) NOT NULL,
  claimed_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_commands_idempotency (facility_id, idempotency_key),
  KEY idx_agent_commands_dispatch (facility_id, status, created_at),
  KEY idx_agent_commands_expiry (status, expires_at)
);

CREATE TABLE standard_sync_runs (
  id CHAR(36) NOT NULL,
  source VARCHAR(24) NOT NULL,
  method VARCHAR(24) NOT NULL,
  window_begin DATE NULL,
  window_end DATE NULL,
  cursor_value VARCHAR(120) NULL,
  received_rows INT UNSIGNED NOT NULL DEFAULT 0,
  changed_rows INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL,
  error_code VARCHAR(64) NULL,
  started_by CHAR(36) NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_standard_sync_source_started (source, started_at)
);

-- No AFTER clauses: TiDB rejects positioning a column after one added in the
-- same ALTER, and physical column order carries no meaning here.
ALTER TABLE drug_mappings
  ADD COLUMN dfscode VARCHAR(64) NULL,
  ADD COLUMN unit_price VARCHAR(80) NULL,
  ADD COLUMN distributor VARCHAR(255) NULL,
  ADD COLUMN ised VARCHAR(8) NULL,
  ADD COLUMN ndc24 VARCHAR(32) NULL,
  ADD COLUMN packsize VARCHAR(120) NULL,
  ADD COLUMN pack_price VARCHAR(80) NULL,
  ADD COLUMN date_change DATE NULL,
  ADD COLUMN date_update DATE NULL,
  ADD COLUMN date_effective DATE NULL,
  ADD COLUMN notes VARCHAR(500) NULL;

ALTER TABLE agent_installations
  ADD COLUMN declared_office_id CHAR(5) NULL,
  ADD COLUMN enrolled_at DATETIME(3) NULL,
  ADD CONSTRAINT fk_agent_installations_facility FOREIGN KEY (facility_id) REFERENCES facilities(id);

ALTER TABLE agent_credentials
  ADD CONSTRAINT fk_agent_credentials_installation FOREIGN KEY (installation_id) REFERENCES agent_installations(installation_id);
