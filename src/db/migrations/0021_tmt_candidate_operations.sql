CREATE TABLE tmt_active_dataset (
  pointer_id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  singleton_id TINYINT UNSIGNED GENERATED ALWAYS AS (1) STORED,
  dataset_id CHAR(36) NULL,
  generation INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_tmt_active_dataset_singleton (singleton_id),
  CONSTRAINT ck_tmt_active_dataset_singleton CHECK (singleton_id = 1),
  CONSTRAINT fk_tmt_active_dataset_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

INSERT INTO tmt_active_dataset (generation) VALUES (0);

CREATE TABLE tmt_candidate_acceptances (
  dataset_id CHAR(36) NOT NULL PRIMARY KEY,
  manifest_hash CHAR(64) NOT NULL,
  assurance VARCHAR(24) NOT NULL,
  coverage_through DATE NOT NULL,
  accepted_by CHAR(36) NOT NULL,
  accepted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tmt_candidate_acceptance_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)
);

CREATE TABLE tmt_candidate_jobs (
  dataset_id CHAR(36) NOT NULL PRIMARY KEY,
  base_dataset_id CHAR(36) NOT NULL,
  base_generation INT UNSIGNED NOT NULL,
  requested_by CHAR(36) NOT NULL,
  mode VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL,
  version VARCHAR(32) NOT NULL,
  plan JSON NOT NULL,
  checkpoint_results JSON NOT NULL,
  next_step INT UNSIGNED NOT NULL DEFAULT 0,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  fence INT UNSIGNED NOT NULL DEFAULT 0,
  lease_until DATETIME(3) NULL,
  seed_complete TINYINT(1) NOT NULL DEFAULT 0,
  received_rows INT UNSIGNED NOT NULL DEFAULT 0,
  written_rows INT UNSIGNED NOT NULL DEFAULT 0,
  warnings_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tmt_candidate_job_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id),
  CONSTRAINT fk_tmt_candidate_job_base FOREIGN KEY (base_dataset_id) REFERENCES standard_datasets(id),
  KEY idx_tmt_candidate_jobs_status (status,updated_at)
);
