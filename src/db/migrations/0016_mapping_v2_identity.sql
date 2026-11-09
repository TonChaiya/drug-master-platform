ALTER TABLE drug_mappings
  ADD COLUMN standard_source VARCHAR(8) NULL AFTER standard_code;

ALTER TABLE drug_mappings
  ADD COLUMN standard_level VARCHAR(16) NULL AFTER standard_source;

ALTER TABLE drug_mappings
  ADD KEY idx_mappings_facility_standard_source (facility_id, standard_source),
  ADD KEY idx_mappings_standard_identity (standard_source, standard_code, standard_level);
