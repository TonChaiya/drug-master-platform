-- Records a rejected agent request whose office.offid did not match the
-- facility its credential belongs to.
--
-- The server already refuses these, but the refusal was only ever visible to
-- the agent on the รพ.สต. machine. Persisting it is what lets the web tell the
-- signed-in user that their account and the connected tray disagree.
ALTER TABLE agent_installations
  ADD COLUMN last_mismatch_office_id VARCHAR(8) NULL,
  ADD COLUMN last_mismatch_at DATETIME(3) NULL;
