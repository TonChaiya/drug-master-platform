ALTER TABLE ttmt_products
  ADD COLUMN ttmt_type VARCHAR(64) NULL AFTER status,
  ADD COLUMN change_date VARCHAR(64) NULL AFTER ttmt_type,
  ADD COLUMN drug_group_nhso VARCHAR(120) NULL AFTER change_date;

ALTER TABLE ttmt_dataset_products
  ADD COLUMN ttmt_type VARCHAR(64) NULL AFTER status,
  ADD COLUMN change_date VARCHAR(64) NULL AFTER ttmt_type,
  ADD COLUMN drug_group_nhso VARCHAR(120) NULL AFTER change_date;
