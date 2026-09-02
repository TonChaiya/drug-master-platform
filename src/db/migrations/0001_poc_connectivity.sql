CREATE TABLE IF NOT EXISTS poc_agent_reports (
  request_id CHAR(36) NOT NULL,
  installation_id CHAR(36) NOT NULL,
  machine_name VARCHAR(128) NOT NULL,
  agent_version VARCHAR(32) NOT NULL,
  office_id CHAR(5) NOT NULL,
  jhcis_connected TINYINT(1) NOT NULL,
  eligible_drug_count INT UNSIGNED NOT NULL,
  checked_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_id),
  KEY idx_poc_agent_reports_office_received (office_id, received_at)
);

CREATE TABLE IF NOT EXISTS poc_events (
  id CHAR(36) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  ok TINYINT(1) NOT NULL,
  message VARCHAR(255) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  http_status SMALLINT UNSIGNED NULL,
  latency_ms INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_poc_events_occurred (occurred_at)
);

CREATE TABLE IF NOT EXISTS poc_agent_nonces (
  nonce_key_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (nonce_key_hash),
  KEY idx_poc_agent_nonces_expires (expires_at)
);
