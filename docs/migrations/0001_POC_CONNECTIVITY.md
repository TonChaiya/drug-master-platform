# Migration 0001: PoC connectivity persistence

Scope: creates only `poc_agent_reports`, `poc_events`, and `poc_agent_nonces` in the dedicated `tmt_drug_master_poc` database. It stores connectivity results and counts only; no drug rows, JHCIS password, Agent secret, Authorization header, or HMAC signature.

Forward fix: rerun `pnpm poc:migrate`; all statements are idempotent `CREATE TABLE IF NOT EXISTS` operations.

Rollback for PoC teardown, after exporting any required evidence:

```sql
DROP TABLE IF EXISTS poc_agent_nonces;
DROP TABLE IF EXISTS poc_events;
DROP TABLE IF EXISTS poc_agent_reports;
```

Dropping the database is intentionally not automated. Confirm its exact name and contents before manual removal.
