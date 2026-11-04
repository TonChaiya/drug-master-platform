CREATE TABLE ttmt_imports (
  id CHAR(36) NOT NULL PRIMARY KEY, version VARCHAR(120) NOT NULL, filename VARCHAR(255) NOT NULL,
  content_hash CHAR(64) NOT NULL, row_count INT UNSIGNED NOT NULL DEFAULT 0, status VARCHAR(24) NOT NULL,
  imported_by CHAR(36) NULL, started_at DATETIME(3) NOT NULL, completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ttmt_imports_version (version), UNIQUE KEY uq_ttmt_imports_hash (content_hash)
);

CREATE TABLE ttmt_products (
  ttmtcode VARCHAR(64) NOT NULL PRIMARY KEY, activeingredient TEXT NULL, strength TEXT NULL, dosageform TEXT NULL,
  contvalue VARCHAR(80) NULL, contunit VARCHAR(120) NULL, dispunit VARCHAR(120) NULL, tradename TEXT NULL,
  manufacturer TEXT NULL, fsn TEXT NULL, status VARCHAR(24) NOT NULL, nlem VARCHAR(32) NULL,
  registration_number VARCHAR(160) NULL, source_version VARCHAR(120) NOT NULL, source_import_id CHAR(36) NOT NULL,
  normalized_generic VARCHAR(255) NULL, normalized_trade VARCHAR(255) NULL, normalized_manufacturer VARCHAR(255) NULL,
  normalized_regno VARCHAR(160) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_ttmt_products_status_code (status, ttmtcode), KEY idx_ttmt_products_generic (normalized_generic),
  KEY idx_ttmt_products_trade (normalized_trade), KEY idx_ttmt_products_manufacturer (normalized_manufacturer),
  KEY idx_ttmt_products_regno (normalized_regno), KEY idx_ttmt_products_import (source_import_id),
  CONSTRAINT fk_ttmt_products_import FOREIGN KEY (source_import_id) REFERENCES ttmt_imports(id)
);
