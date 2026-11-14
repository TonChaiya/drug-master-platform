CREATE TABLE standard_datasets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  source VARCHAR(8) NOT NULL,
  state VARCHAR(24) NOT NULL,
  source_version VARCHAR(120) NOT NULL,
  content_hash CHAR(64) NULL,
  tmt_sync_run_id CHAR(36) NULL,
  ttmt_import_id CHAR(36) NULL,
  error_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  UNIQUE KEY uq_standard_datasets_tmt_run (tmt_sync_run_id),
  UNIQUE KEY uq_standard_datasets_ttmt_import (ttmt_import_id),
  KEY idx_standard_datasets_source_state (source,state,created_at),
  CONSTRAINT fk_standard_datasets_tmt_run FOREIGN KEY (tmt_sync_run_id) REFERENCES tmt_sync_runs(id),
  CONSTRAINT fk_standard_datasets_ttmt_import FOREIGN KEY (ttmt_import_id) REFERENCES ttmt_imports(id)
);

CREATE TABLE standard_releases (
  id CHAR(36) NOT NULL PRIMARY KEY,
  state VARCHAR(24) NOT NULL,
  tmt_dataset_id CHAR(36) NOT NULL,
  ttmt_dataset_id CHAR(36) NOT NULL,
  validation_run_id CHAR(36) NULL,
  validation_evidence_sha256 CHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  approved_at DATETIME(3) NULL,
  superseded_at DATETIME(3) NULL,
  UNIQUE KEY uq_standard_releases_datasets (tmt_dataset_id,ttmt_dataset_id),
  KEY idx_standard_releases_state_created (state,created_at),
  CONSTRAINT fk_standard_releases_tmt_dataset FOREIGN KEY (tmt_dataset_id) REFERENCES standard_datasets(id),
  CONSTRAINT fk_standard_releases_ttmt_dataset FOREIGN KEY (ttmt_dataset_id) REFERENCES standard_datasets(id),
  CONSTRAINT fk_standard_releases_validation_run FOREIGN KEY (validation_run_id) REFERENCES tmt_run_validations(run_id)
);

CREATE TABLE standard_dataset_pointers (
  pointer_key VARCHAR(32) NOT NULL PRIMARY KEY,
  active_release_id CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_standard_dataset_pointers_release FOREIGN KEY (active_release_id) REFERENCES standard_releases(id)
);

CREATE TABLE standard_dataset_manifests (
  dataset_id CHAR(36) NOT NULL,
  table_name VARCHAR(64) NOT NULL,
  row_count INT UNSIGNED NOT NULL,
  content_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,table_name),
  CONSTRAINT fk_standard_dataset_manifests_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_subs (
  dataset_id CHAR(36) NOT NULL,
  subsid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,subsid), KEY idx_tmt_subs_change (change_date, subsid), KEY idx_tmt_subs_fsn (normalized_fsn),
  KEY idx_tmt_dataset_subs_lookup (dataset_id,subsid), CONSTRAINT fk_tmt_dataset_subs_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_vtm (
  dataset_id CHAR(36) NOT NULL,
  vtmid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,vtmid), KEY idx_tmt_vtm_change (change_date, vtmid), KEY idx_tmt_vtm_fsn (normalized_fsn),
  KEY idx_tmt_dataset_vtm_lookup (dataset_id,vtmid), CONSTRAINT fk_tmt_dataset_vtm_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_gp (
  dataset_id CHAR(36) NOT NULL,
  gpid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,gpid), KEY idx_tmt_gp_change (change_date, gpid), KEY idx_tmt_gp_fsn (normalized_fsn),
  KEY idx_tmt_dataset_gp_lookup (dataset_id,gpid), CONSTRAINT fk_tmt_dataset_gp_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_gpu (
  dataset_id CHAR(36) NOT NULL,
  gpuid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,gpuid), KEY idx_tmt_gpu_change (change_date, gpuid), KEY idx_tmt_gpu_fsn (normalized_fsn),
  KEY idx_tmt_dataset_gpu_lookup (dataset_id,gpuid), CONSTRAINT fk_tmt_dataset_gpu_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_gpp (
  dataset_id CHAR(36) NOT NULL,
  gppid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,gppid), KEY idx_tmt_gpp_change (change_date, gppid), KEY idx_tmt_gpp_fsn (normalized_fsn),
  KEY idx_tmt_dataset_gpp_lookup (dataset_id,gppid), CONSTRAINT fk_tmt_dataset_gpp_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_tp (
  dataset_id CHAR(36) NOT NULL,
  tpid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, manufacturer TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, normalized_manufacturer VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,tpid), KEY idx_tmt_tp_change (change_date, tpid), KEY idx_tmt_tp_fsn (normalized_fsn), KEY idx_tmt_tp_manufacturer (normalized_manufacturer),
  KEY idx_tmt_dataset_tp_lookup (dataset_id,tpid), CONSTRAINT fk_tmt_dataset_tp_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_tpu (
  dataset_id CHAR(36) NOT NULL,
  tpuid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, manufacturer TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, normalized_manufacturer VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,tpuid), KEY idx_tmt_tpu_change (change_date, tpuid), KEY idx_tmt_tpu_fsn (normalized_fsn), KEY idx_tmt_tpu_manufacturer (normalized_manufacturer),
  KEY idx_tmt_dataset_tpu_lookup (dataset_id,tpuid), CONSTRAINT fk_tmt_dataset_tpu_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_tpp (
  dataset_id CHAR(36) NOT NULL,
  tppid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, manufacturer TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, normalized_manufacturer VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,tppid), KEY idx_tmt_tpp_change (change_date, tppid), KEY idx_tmt_tpp_fsn (normalized_fsn), KEY idx_tmt_tpp_manufacturer (normalized_manufacturer),
  KEY idx_tmt_dataset_tpp_lookup (dataset_id,tppid), CONSTRAINT fk_tmt_dataset_tpp_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_nlem (
  dataset_id CHAR(36) NOT NULL,
  tpuid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, nlem VARCHAR(32) NOT NULL, change_date DATE NOT NULL,
  source_version VARCHAR(32) NOT NULL, synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,tpuid,change_date,nlem), KEY idx_tmt_nlem_tpu_change (tpuid, change_date), KEY idx_tmt_nlem_value_tpu (nlem, tpuid),
  KEY idx_tmt_dataset_nlem_lookup (dataset_id,tpuid,change_date), CONSTRAINT fk_tmt_dataset_nlem_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_atc (
  dataset_id CHAR(36) NOT NULL,
  tpuid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, atc VARCHAR(32) NOT NULL, change_date DATE NOT NULL,
  source_version VARCHAR(32) NOT NULL, synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,tpuid,change_date,atc), KEY idx_tmt_atc_tpu_change (tpuid, change_date), KEY idx_tmt_atc_value_tpu (atc, tpuid),
  KEY idx_tmt_dataset_atc_lookup (dataset_id,tpuid,change_date), CONSTRAINT fk_tmt_dataset_atc_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_regno (
  dataset_id CHAR(36) NOT NULL,
  tpuid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, regno VARCHAR(160) NOT NULL, normalized_regno VARCHAR(160) NOT NULL, change_date DATE NOT NULL,
  source_version VARCHAR(32) NOT NULL, synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,tpuid,change_date,regno), KEY idx_tmt_regno_tpu_change (tpuid, change_date), KEY idx_tmt_regno_value_tpu (normalized_regno, tpuid),
  KEY idx_tmt_dataset_regno_lookup (dataset_id,tpuid,change_date), CONSTRAINT fk_tmt_dataset_regno_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_mastertmt (
  dataset_id CHAR(36) NOT NULL,
  tpucode BIGINT UNSIGNED NOT NULL, activeingredient TEXT NULL, strength TEXT NULL, dosageform TEXT NULL,
  contvalue VARCHAR(80) NULL, contunit VARCHAR(120) NULL, dispunit VARCHAR(120) NULL, tradename TEXT NULL, manufacturer TEXT NULL, fsn TEXT NULL,
  status TINYINT UNSIGNED NOT NULL, normalized_generic VARCHAR(255) NULL, normalized_trade VARCHAR(255) NULL,
  normalized_manufacturer VARCHAR(255) NULL, normalized_fsn VARCHAR(255) NULL,
  source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL, synced_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,tpucode), KEY idx_tmt_master_status (status, tpucode), KEY idx_tmt_master_generic (normalized_generic), KEY idx_tmt_master_trade (normalized_trade),
  KEY idx_tmt_master_manufacturer (normalized_manufacturer), KEY idx_tmt_dataset_master_lookup (dataset_id,status,tpucode),
  CONSTRAINT fk_tmt_dataset_master_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_concepts (
  dataset_id CHAR(36) NOT NULL,
  tmtid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, change_date DATE NOT NULL, level_name VARCHAR(16) NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,tmtid), KEY idx_tmt_concept_level (level_name, tmtid), KEY idx_tmt_concept_change (change_date, tmtid), KEY idx_tmt_concept_fsn (normalized_fsn),
  KEY idx_tmt_dataset_concept_lookup (dataset_id,level_name,tmtid), CONSTRAINT fk_tmt_dataset_concepts_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_dataset_relationships (
  dataset_id CHAR(36) NOT NULL,
  concept1 BIGINT UNSIGNED NOT NULL, concept2 BIGINT UNSIGNED NOT NULL, change_date DATE NOT NULL,
  level_name1 VARCHAR(16) NOT NULL, level_name2 VARCHAR(16) NOT NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,concept1,concept2), KEY idx_tmt_relationship_reverse (concept2, concept1),
  KEY idx_tmt_relationship_level1 (level_name1, concept1), KEY idx_tmt_relationship_level2 (level_name2, concept2), KEY idx_tmt_relationship_change (change_date, concept1),
  KEY idx_tmt_dataset_relationship_reverse (dataset_id,concept2,concept1), CONSTRAINT fk_tmt_dataset_relationships_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE ttmt_dataset_products (
  dataset_id CHAR(36) NOT NULL,
  ttmtcode VARCHAR(64) NOT NULL, activeingredient TEXT NULL, strength TEXT NULL, dosageform TEXT NULL,
  contvalue VARCHAR(80) NULL, contunit VARCHAR(120) NULL, dispunit VARCHAR(120) NULL, tradename TEXT NULL,
  manufacturer TEXT NULL, fsn TEXT NULL, status VARCHAR(24) NOT NULL, nlem VARCHAR(32) NULL,
  registration_number VARCHAR(160) NULL, source_version VARCHAR(120) NOT NULL, source_import_id CHAR(36) NOT NULL,
  normalized_generic VARCHAR(255) NULL, normalized_trade VARCHAR(255) NULL, normalized_manufacturer VARCHAR(255) NULL,
  normalized_regno VARCHAR(160) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dataset_id,ttmtcode), KEY idx_ttmt_products_status_code (status, ttmtcode), KEY idx_ttmt_products_generic (normalized_generic),
  KEY idx_ttmt_products_trade (normalized_trade), KEY idx_ttmt_products_manufacturer (normalized_manufacturer),
  KEY idx_ttmt_products_regno (normalized_regno), KEY idx_ttmt_products_import (source_import_id),
  KEY idx_ttmt_dataset_product_lookup (dataset_id,status,ttmtcode), CONSTRAINT fk_ttmt_dataset_products_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);
