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

CREATE TABLE tmt_dataset_subs LIKE tmt_subs;
ALTER TABLE tmt_dataset_subs DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,subsid), ADD KEY idx_tmt_dataset_subs_lookup (dataset_id,subsid), ADD CONSTRAINT fk_tmt_dataset_subs_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_vtm LIKE tmt_vtm;
ALTER TABLE tmt_dataset_vtm DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,vtmid), ADD KEY idx_tmt_dataset_vtm_lookup (dataset_id,vtmid), ADD CONSTRAINT fk_tmt_dataset_vtm_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_gp LIKE tmt_gp;
ALTER TABLE tmt_dataset_gp DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,gpid), ADD KEY idx_tmt_dataset_gp_lookup (dataset_id,gpid), ADD CONSTRAINT fk_tmt_dataset_gp_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_gpu LIKE tmt_gpu;
ALTER TABLE tmt_dataset_gpu DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,gpuid), ADD KEY idx_tmt_dataset_gpu_lookup (dataset_id,gpuid), ADD CONSTRAINT fk_tmt_dataset_gpu_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_gpp LIKE tmt_gpp;
ALTER TABLE tmt_dataset_gpp DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,gppid), ADD KEY idx_tmt_dataset_gpp_lookup (dataset_id,gppid), ADD CONSTRAINT fk_tmt_dataset_gpp_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_tp LIKE tmt_tp;
ALTER TABLE tmt_dataset_tp DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,tpid), ADD KEY idx_tmt_dataset_tp_lookup (dataset_id,tpid), ADD CONSTRAINT fk_tmt_dataset_tp_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_tpu LIKE tmt_tpu;
ALTER TABLE tmt_dataset_tpu DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,tpuid), ADD KEY idx_tmt_dataset_tpu_lookup (dataset_id,tpuid), ADD CONSTRAINT fk_tmt_dataset_tpu_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_tpp LIKE tmt_tpp;
ALTER TABLE tmt_dataset_tpp DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,tppid), ADD KEY idx_tmt_dataset_tpp_lookup (dataset_id,tppid), ADD CONSTRAINT fk_tmt_dataset_tpp_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_nlem LIKE tmt_nlem;
ALTER TABLE tmt_dataset_nlem DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,tpuid,change_date,nlem), ADD KEY idx_tmt_dataset_nlem_lookup (dataset_id,tpuid,change_date), ADD CONSTRAINT fk_tmt_dataset_nlem_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_atc LIKE tmt_atc;
ALTER TABLE tmt_dataset_atc DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,tpuid,change_date,atc), ADD KEY idx_tmt_dataset_atc_lookup (dataset_id,tpuid,change_date), ADD CONSTRAINT fk_tmt_dataset_atc_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_regno LIKE tmt_regno;
ALTER TABLE tmt_dataset_regno DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,tpuid,change_date,regno), ADD KEY idx_tmt_dataset_regno_lookup (dataset_id,tpuid,change_date), ADD CONSTRAINT fk_tmt_dataset_regno_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_mastertmt LIKE tmt_mastertmt;
ALTER TABLE tmt_dataset_mastertmt DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,tpucode), ADD KEY idx_tmt_dataset_master_lookup (dataset_id,status,tpucode), ADD CONSTRAINT fk_tmt_dataset_master_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_concepts LIKE tmt_concept;
ALTER TABLE tmt_dataset_concepts DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,tmtid), ADD KEY idx_tmt_dataset_concept_lookup (dataset_id,level_name,tmtid), ADD CONSTRAINT fk_tmt_dataset_concepts_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE tmt_dataset_relationships LIKE tmt_relationship;
ALTER TABLE tmt_dataset_relationships DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,concept1,concept2), ADD KEY idx_tmt_dataset_relationship_reverse (dataset_id,concept2,concept1), ADD CONSTRAINT fk_tmt_dataset_relationships_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
CREATE TABLE ttmt_dataset_products LIKE ttmt_products;
ALTER TABLE ttmt_dataset_products DROP PRIMARY KEY, ADD COLUMN dataset_id CHAR(36) NOT NULL FIRST, ADD PRIMARY KEY (dataset_id,ttmtcode), ADD KEY idx_ttmt_dataset_product_lookup (dataset_id,status,ttmtcode), ADD CONSTRAINT fk_ttmt_dataset_products_dataset FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id);
