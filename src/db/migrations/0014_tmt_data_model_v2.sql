CREATE TABLE tmt_subs (
  subsid BIGINT UNSIGNED NOT NULL PRIMARY KEY, fsn TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tmt_subs_change (change_date, subsid), KEY idx_tmt_subs_fsn (normalized_fsn)
);

CREATE TABLE tmt_vtm (
  vtmid BIGINT UNSIGNED NOT NULL PRIMARY KEY, fsn TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tmt_vtm_change (change_date, vtmid), KEY idx_tmt_vtm_fsn (normalized_fsn)
);

CREATE TABLE tmt_gp (
  gpid BIGINT UNSIGNED NOT NULL PRIMARY KEY, fsn TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tmt_gp_change (change_date, gpid), KEY idx_tmt_gp_fsn (normalized_fsn)
);

CREATE TABLE tmt_gpu (
  gpuid BIGINT UNSIGNED NOT NULL PRIMARY KEY, fsn TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tmt_gpu_change (change_date, gpuid), KEY idx_tmt_gpu_fsn (normalized_fsn)
);

CREATE TABLE tmt_gpp (
  gppid BIGINT UNSIGNED NOT NULL PRIMARY KEY, fsn TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tmt_gpp_change (change_date, gppid), KEY idx_tmt_gpp_fsn (normalized_fsn)
);

CREATE TABLE tmt_tp (
  tpid BIGINT UNSIGNED NOT NULL PRIMARY KEY, fsn TEXT NOT NULL, manufacturer TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, normalized_manufacturer VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tmt_tp_change (change_date, tpid), KEY idx_tmt_tp_fsn (normalized_fsn), KEY idx_tmt_tp_manufacturer (normalized_manufacturer)
);

CREATE TABLE tmt_tpu (
  tpuid BIGINT UNSIGNED NOT NULL PRIMARY KEY, fsn TEXT NOT NULL, manufacturer TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, normalized_manufacturer VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tmt_tpu_change (change_date, tpuid), KEY idx_tmt_tpu_fsn (normalized_fsn), KEY idx_tmt_tpu_manufacturer (normalized_manufacturer)
);

CREATE TABLE tmt_tpp (
  tppid BIGINT UNSIGNED NOT NULL PRIMARY KEY, fsn TEXT NOT NULL, manufacturer TEXT NOT NULL, change_date DATE NOT NULL,
  normalized_fsn VARCHAR(255) NULL, normalized_manufacturer VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tmt_tpp_change (change_date, tppid), KEY idx_tmt_tpp_fsn (normalized_fsn), KEY idx_tmt_tpp_manufacturer (normalized_manufacturer)
);

CREATE TABLE tmt_nlem (
  tpuid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, nlem VARCHAR(32) NOT NULL, change_date DATE NOT NULL,
  source_version VARCHAR(32) NOT NULL, synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tpuid, change_date, nlem), KEY idx_tmt_nlem_tpu_change (tpuid, change_date), KEY idx_tmt_nlem_value_tpu (nlem, tpuid)
);

CREATE TABLE tmt_atc (
  tpuid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, atc VARCHAR(32) NOT NULL, change_date DATE NOT NULL,
  source_version VARCHAR(32) NOT NULL, synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tpuid, change_date, atc), KEY idx_tmt_atc_tpu_change (tpuid, change_date), KEY idx_tmt_atc_value_tpu (atc, tpuid)
);

CREATE TABLE tmt_regno (
  tpuid BIGINT UNSIGNED NOT NULL, fsn TEXT NOT NULL, regno VARCHAR(160) NOT NULL, normalized_regno VARCHAR(160) NOT NULL, change_date DATE NOT NULL,
  source_version VARCHAR(32) NOT NULL, synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tpuid, change_date, regno), KEY idx_tmt_regno_tpu_change (tpuid, change_date), KEY idx_tmt_regno_value_tpu (normalized_regno, tpuid)
);

CREATE TABLE tmt_mastertmt (
  tpucode BIGINT UNSIGNED NOT NULL PRIMARY KEY, activeingredient TEXT NULL, strength TEXT NULL, dosageform TEXT NULL,
  contvalue VARCHAR(80) NULL, contunit VARCHAR(120) NULL, dispunit VARCHAR(120) NULL, tradename TEXT NULL, manufacturer TEXT NULL, fsn TEXT NULL,
  status TINYINT UNSIGNED NOT NULL, normalized_generic VARCHAR(255) NULL, normalized_trade VARCHAR(255) NULL,
  normalized_manufacturer VARCHAR(255) NULL, normalized_fsn VARCHAR(255) NULL,
  source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL, synced_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tmt_master_status (status, tpucode), KEY idx_tmt_master_generic (normalized_generic), KEY idx_tmt_master_trade (normalized_trade),
  KEY idx_tmt_master_manufacturer (normalized_manufacturer)
);

CREATE TABLE tmt_concept (
  tmtid BIGINT UNSIGNED NOT NULL PRIMARY KEY, fsn TEXT NOT NULL, change_date DATE NOT NULL, level_name VARCHAR(16) NOT NULL,
  normalized_fsn VARCHAR(255) NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_tmt_concept_level (level_name, tmtid), KEY idx_tmt_concept_change (change_date, tmtid), KEY idx_tmt_concept_fsn (normalized_fsn)
);

CREATE TABLE tmt_relationship (
  concept1 BIGINT UNSIGNED NOT NULL, concept2 BIGINT UNSIGNED NOT NULL, change_date DATE NOT NULL,
  level_name1 VARCHAR(16) NOT NULL, level_name2 VARCHAR(16) NOT NULL, source_version VARCHAR(32) NOT NULL, last_seen_version VARCHAR(32) NOT NULL,
  synced_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (concept1, concept2), KEY idx_tmt_relationship_reverse (concept2, concept1),
  KEY idx_tmt_relationship_level1 (level_name1, concept1), KEY idx_tmt_relationship_level2 (level_name2, concept2),
  KEY idx_tmt_relationship_change (change_date, concept1)
);

CREATE TABLE tmt_sync_runs (
  id CHAR(36) NOT NULL PRIMARY KEY, tmt_version VARCHAR(32) NOT NULL, mode VARCHAR(16) NOT NULL, status VARCHAR(24) NOT NULL,
  started_by CHAR(36) NULL, received_rows INT UNSIGNED NOT NULL DEFAULT 0, written_rows INT UNSIGNED NOT NULL DEFAULT 0,
  warnings_count INT UNSIGNED NOT NULL DEFAULT 0, error_code VARCHAR(64) NULL, started_at DATETIME(3) NOT NULL, finished_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY idx_tmt_sync_runs_status_started (status, started_at)
);

CREATE TABLE tmt_version (
  id CHAR(36) NOT NULL PRIMARY KEY, tmt_version VARCHAR(32) NOT NULL, observed_at DATETIME(3) NOT NULL,
  http_latency_ms INT UNSIGNED NULL, core_sync_run_id CHAR(36) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tmt_version_observation (tmt_version, observed_at), KEY idx_tmt_version_value (tmt_version), KEY idx_tmt_version_observed (observed_at)
);

CREATE TABLE tmt_sync_checkpoints (
  run_id CHAR(36) NOT NULL, endpoint VARCHAR(32) NOT NULL, window_begin DATE NOT NULL, window_end DATE NOT NULL,
  status VARCHAR(24) NOT NULL, received_rows INT UNSIGNED NOT NULL DEFAULT 0, written_rows INT UNSIGNED NOT NULL DEFAULT 0,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0, error_code VARCHAR(64) NULL, started_at DATETIME(3) NULL, finished_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (run_id, endpoint, window_begin, window_end), KEY idx_tmt_sync_checkpoint_resume (run_id, status, endpoint),
  CONSTRAINT fk_tmt_sync_checkpoint_run FOREIGN KEY (run_id) REFERENCES tmt_sync_runs(id) ON DELETE CASCADE
);
