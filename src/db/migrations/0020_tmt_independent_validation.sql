ALTER TABLE tmt_run_validations
  MODIFY COLUMN ttmt_import_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN ttmt_content_hash CHAR(64) NULL,
  MODIFY COLUMN ttmt_row_count INT UNSIGNED NULL;
