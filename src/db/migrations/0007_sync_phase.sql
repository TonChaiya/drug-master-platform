-- A MasterTMT sync now runs in two passes and has to remember which one it is in.
--
-- NLEM was applied per window to whatever products existed at that moment, so a
-- national-list record for a drug whose TPU record arrived in a later window was
-- dropped and never revisited. That lost 3,432 of 3,447 missing NLEM values.
-- Loading every product first, then applying NLEM, removes the ordering.
ALTER TABLE standard_sync_runs ADD COLUMN phase VARCHAR(16) NULL;
