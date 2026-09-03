-- Lets an interrupted MasterTMT sync continue instead of starting over.
--
-- The initial load spans 2013 to today, so a dropped connection part-way
-- through used to mean re-fetching everything already applied.
ALTER TABLE standard_sync_runs
  ADD COLUMN next_window_begin DATE NULL,
  ADD COLUMN completed_windows INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN total_windows INT UNSIGNED NOT NULL DEFAULT 0;
