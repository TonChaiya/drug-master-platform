-- Which account registered a machine.
--
-- It was only ever recorded in audit_logs, so the JHCIS page could not show a
-- user their own machines and nobody else's. Existing rows are backfilled from
-- the most recent agent.enrolled entry, because re-enrolling hands the machine
-- to whoever did it last.
ALTER TABLE agent_installations ADD COLUMN enrolled_by CHAR(36) NULL;

UPDATE agent_installations i
SET enrolled_by = (
  SELECT a.actor_user_id
  FROM audit_logs a
  WHERE a.action = 'agent.enrolled'
    AND a.entity_id = i.installation_id
    AND a.actor_user_id IS NOT NULL
  ORDER BY a.created_at DESC
  LIMIT 1
);
