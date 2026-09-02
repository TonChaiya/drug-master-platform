CREATE TABLE facilities (
  id CHAR(36) NOT NULL,
  facility_code CHAR(5) NOT NULL,
  facility_name VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_facilities_code (facility_code),
  KEY idx_facilities_status (status)
);

CREATE TABLE users (
  id CHAR(36) NOT NULL,
  facility_id CHAR(36) NULL,
  username VARCHAR(80) NOT NULL,
  username_normalized VARCHAR(80) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  position_name VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username_normalized (username_normalized),
  KEY idx_users_facility_status (facility_id, status),
  CONSTRAINT fk_users_facility FOREIGN KEY (facility_id) REFERENCES facilities(id)
);

CREATE TABLE sessions (
  id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  ip_hash CHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  KEY idx_sessions_user_active (user_id, revoked_at, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE audit_logs (
  id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NULL,
  effective_facility_id CHAR(36) NULL,
  action VARCHAR(96) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(96) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  request_ip_hash CHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_facility_created (effective_facility_id, created_at),
  KEY idx_audit_actor_created (actor_user_id, created_at)
);

CREATE TABLE standard_imports (
  id CHAR(36) NOT NULL,
  kind VARCHAR(24) NOT NULL,
  version VARCHAR(120) NOT NULL,
  content_hash CHAR(64) NULL,
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL,
  imported_by CHAR(36) NULL,
  started_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_standard_import_kind_version (kind, version)
);

CREATE TABLE standard_products (
  id CHAR(36) NOT NULL,
  standard_code VARCHAR(64) NOT NULL,
  standard_type VARCHAR(8) NOT NULL,
  active_ingredient TEXT NULL,
  strength VARCHAR(255) NULL,
  dosage_form VARCHAR(255) NULL,
  content_value VARCHAR(80) NULL,
  content_unit VARCHAR(80) NULL,
  dispensing_unit VARCHAR(80) NULL,
  trade_name VARCHAR(255) NULL,
  manufacturer VARCHAR(255) NULL,
  fsn TEXT NULL,
  status VARCHAR(24) NOT NULL,
  raw_nlem VARCHAR(32) NULL,
  export_ised VARCHAR(8) NULL,
  registration_number VARCHAR(160) NULL,
  source_version VARCHAR(120) NOT NULL,
  source_changed_at DATETIME(3) NULL,
  normalized_generic VARCHAR(255) NULL,
  normalized_trade VARCHAR(255) NULL,
  normalized_manufacturer VARCHAR(255) NULL,
  normalized_regno VARCHAR(160) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_standard_products_code (standard_code),
  KEY idx_standard_type_status_code (standard_type, status, standard_code),
  KEY idx_standard_generic (standard_type, status, normalized_generic),
  KEY idx_standard_trade (standard_type, status, normalized_trade)
);

CREATE TABLE source_drugs (
  id CHAR(36) NOT NULL,
  facility_id CHAR(36) NOT NULL,
  drugcode VARCHAR(64) NOT NULL,
  drugname VARCHAR(255) NULL,
  drugnamethai VARCHAR(255) NULL,
  druggenericname VARCHAR(255) NULL,
  drugtype VARCHAR(8) NOT NULL,
  pack VARCHAR(120) NULL,
  unitsell VARCHAR(120) NULL,
  unitusage VARCHAR(120) NULL,
  cost DECIMAL(18,4) NULL,
  sell DECIMAL(18,4) NULL,
  nationaccount VARCHAR(32) NULL,
  drugcode24 VARCHAR(32) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  last_seen_sync_id CHAR(36) NOT NULL,
  source_updated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_source_drugs_facility_code (facility_id, drugcode),
  KEY idx_source_drugs_facility_active (facility_id, active),
  CONSTRAINT fk_source_drugs_facility FOREIGN KEY (facility_id) REFERENCES facilities(id)
);

CREATE TABLE drug_catalog_imports (
  id CHAR(36) NOT NULL,
  facility_id CHAR(36) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  source_version VARCHAR(120) NULL,
  source_date DATE NULL,
  row_count INT UNSIGNED NOT NULL,
  imported_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalog_facility_hash (facility_id, content_hash),
  KEY idx_catalog_facility_created (facility_id, created_at)
);

CREATE TABLE drug_catalog_rows (
  id CHAR(36) NOT NULL,
  import_id CHAR(36) NOT NULL,
  facility_id CHAR(36) NOT NULL,
  source_row_number INT UNSIGNED NOT NULL,
  hospdrugcode VARCHAR(64) NOT NULL,
  productcat VARCHAR(8) NULL,
  tmtid VARCHAR(64) NULL,
  specprep VARCHAR(255) NULL,
  genericname TEXT NULL,
  tradename VARCHAR(255) NULL,
  dfscode VARCHAR(64) NULL,
  dosageform VARCHAR(255) NULL,
  strength VARCHAR(255) NULL,
  content VARCHAR(255) NULL,
  unitprice VARCHAR(80) NULL,
  distributor VARCHAR(255) NULL,
  manufacturer VARCHAR(255) NULL,
  ised VARCHAR(8) NULL,
  ndc24 VARCHAR(32) NULL,
  packsize VARCHAR(120) NULL,
  packprice VARCHAR(80) NULL,
  updateflag VARCHAR(8) NULL,
  datechange VARCHAR(32) NULL,
  dateupdate VARCHAR(32) NULL,
  dateeffective VARCHAR(32) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalog_row_import_code (import_id, hospdrugcode),
  KEY idx_catalog_rows_facility_code (facility_id, hospdrugcode)
);

CREATE TABLE drug_mappings (
  id CHAR(36) NOT NULL,
  facility_id CHAR(36) NOT NULL,
  source_drug_id CHAR(36) NOT NULL,
  standard_code VARCHAR(64) NOT NULL,
  product_cat VARCHAR(8) NOT NULL,
  spec_prep VARCHAR(255) NULL,
  update_flag VARCHAR(8) NOT NULL,
  source VARCHAR(24) NOT NULL,
  catalog_import_id CHAR(36) NULL,
  mapped_by CHAR(36) NOT NULL,
  mapped_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mappings_facility_source (facility_id, source_drug_id),
  KEY idx_mappings_facility_mapped (facility_id, mapped_at)
);

CREATE TABLE agent_installations (
  installation_id CHAR(36) NOT NULL,
  facility_id CHAR(36) NOT NULL,
  machine_label VARCHAR(128) NOT NULL,
  status VARCHAR(24) NOT NULL,
  last_seen_at DATETIME(3) NULL,
  agent_version VARCHAR(32) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (installation_id),
  KEY idx_agent_installations_facility_status (facility_id, status)
);

CREATE TABLE agent_credentials (
  id CHAR(36) NOT NULL,
  installation_id CHAR(36) NOT NULL,
  public_key_id VARCHAR(96) NOT NULL,
  encrypted_secret TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  last_used_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_credentials_public_key (public_key_id),
  KEY idx_agent_credentials_installation_active (installation_id, revoked_at)
);

CREATE TABLE agent_enrollment_tokens (
  id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  facility_id CHAR(36) NOT NULL,
  created_by CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_enrollment_token_hash (token_hash),
  KEY idx_agent_enrollment_facility_expiry (facility_id, expires_at)
);

CREATE TABLE agent_sync_sessions (
  id CHAR(36) NOT NULL,
  installation_id CHAR(36) NOT NULL,
  facility_id CHAR(36) NOT NULL,
  declared_office_id CHAR(5) NOT NULL,
  expected_rows INT UNSIGNED NOT NULL,
  received_rows INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_agent_sync_facility_status (facility_id, status)
);

CREATE TABLE agent_sync_staging (
  id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  facility_id CHAR(36) NOT NULL,
  drugcode VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_staging_session_drug (session_id, drugcode),
  KEY idx_agent_staging_facility_session (facility_id, session_id)
);

CREATE TABLE agent_request_nonces (
  credential_id CHAR(36) NOT NULL,
  nonce_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (credential_id, nonce_hash),
  KEY idx_agent_nonces_expires (expires_at)
);
