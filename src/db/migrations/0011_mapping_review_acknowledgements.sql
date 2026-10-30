CREATE TABLE mapping_review_acknowledgements (
  facility_id char(36) NOT NULL,
  mapping_id char(36) NOT NULL,
  mapping_updated_at datetime(3) NOT NULL,
  catalog_present tinyint(1) NOT NULL,
  catalog_tmtid varchar(64) NULL,
  catalog_import_id char(36) NULL,
  confirmed_by char(36) NOT NULL,
  confirmed_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (facility_id, mapping_id),
  CONSTRAINT fk_mapping_review_ack_mapping
    FOREIGN KEY (facility_id, mapping_id)
    REFERENCES drug_mappings (facility_id, id)
    ON DELETE CASCADE,
  CONSTRAINT chk_mapping_review_ack_catalog_present
    CHECK (catalog_present IN (0, 1))
);
