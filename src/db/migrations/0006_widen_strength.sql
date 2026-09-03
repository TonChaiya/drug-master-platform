-- Real MasterTMT strengths exceed 255 characters: a combination vaccine lists
-- every serotype, e.g. 353 characters for PREVNAR 20. The whole window's insert
-- failed on it, so the historical load could never get past 2024.
ALTER TABLE standard_products MODIFY COLUMN strength TEXT NULL;
