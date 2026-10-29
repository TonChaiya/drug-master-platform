ALTER TABLE drug_mappings
  ADD UNIQUE KEY uq_mappings_facility_id (facility_id, id);

CREATE TABLE mapping_export_checkpoints (
  facility_id CHAR(36) NOT NULL,
  mapping_id CHAR(36) NOT NULL,
  mapping_updated_at DATETIME(3) NOT NULL,
  export_id VARCHAR(96) NOT NULL,
  exported_at DATETIME(3) NOT NULL,
  PRIMARY KEY (facility_id, mapping_id),
  KEY idx_mapping_export_facility_time (facility_id, exported_at),
  CONSTRAINT fk_mapping_export_checkpoint_mapping
    FOREIGN KEY (facility_id, mapping_id) REFERENCES drug_mappings(facility_id, id) ON DELETE CASCADE
);

CREATE TABLE export_preview_tokens (
  token_hash CHAR(64) NOT NULL,
  facility_id CHAR(36) NOT NULL,
  selection VARCHAR(24) NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token_hash),
  KEY idx_export_preview_facility_active (facility_id, consumed_at, expires_at),
  CONSTRAINT fk_export_preview_facility FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE
);
