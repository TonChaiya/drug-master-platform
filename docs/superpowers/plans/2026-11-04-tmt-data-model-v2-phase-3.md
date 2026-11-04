# TMT Data Model v2 Phase 3 Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dormant, resumable TMT v2 sync engine that can full/incremental sync the approved endpoints into an isolated local database, verify invariants and code `764169`, while leaving every production consumer on the legacy path.

**Architecture:** Add focused modules under `src/modules/tmt/` for deterministic windows, bounded retries, persistence/checkpoints, orchestration, and invariant queries. The engine accepts explicit source and repository dependencies so unit tests never need credentials and local live verification can keep its local write connection separate from the one permitted read-only credential lookup. Existing migrations 0014/0015 and legacy `src/modules/standards/sync.ts` remain unchanged; no route, cron, or production import activates v2.

**Tech Stack:** TypeScript strict, mysql2/MySQL transactions, Zod-validated TMT client, Vitest, Laragon MySQL 8.

**Spec:** `docs/superpowers/specs/2026-11-04-tmt-data-model-v2-design.md`

## Global Constraints

- Core endpoints are version, subs, vtm, gp, gpu, gpp, tp, tpu, tpp, nlem, regno, mastertmt, concept, and relationship.
- ATC and imagelist are optional/failure-isolated; image is on-demand only and never bulk-synced.
- Full windows cover 2013-01-01 through the Bangkok run date, maximum 365 days, deterministic and non-overlapping.
- Incremental cursors are endpoint-specific with a 30-day inclusive overlap; absence never deletes data.
- A run is bound to the version observed before work and must fail stale if the final observation differs.
- Retry timeout/network/429/5xx at most three total attempts with bounded exponential backoff plus jitter; respect Retry-After; refresh token once on 401/403.
- Writes are chunked at 500 rows, checkpoint advancement and its data write share one transaction, and replay is idempotent.
- Production migrations, DB writes, routes, crons, search, mapping, export, catalog, and TTMT importer cutover are forbidden.
- DB integration tests require the existing fail-closed localhost/test-database guard.
- Migrations 0001-0015 are immutable; create 0016 only if a proven schema defect blocks the approved behavior.

## Review Focus

- A crash after data write but before checkpoint success must roll back both, so resume cannot skip uncheckpointed data.
- Same-date conflicting level/concept payloads must be observable warnings and must not silently replace the stored source truth.
- Version drift after hours of windows must retain idempotent rows, mark the run stale, and never publish core readiness.
- One optional endpoint permanently failing must not hide a core failure or prevent a genuinely successful core run.
- Token/auth retry must remain bounded independently from general transient retries and must never expose credentials or bearer tokens.

---

### Task 1: Deterministic windows and retry policy

**Files:**
- Create: `src/modules/tmt/windows.ts`
- Create: `src/modules/tmt/retry.ts`
- Create: `tests/tmt-v2-sync.test.ts`
- Modify: `src/modules/standards/tmt-client.ts`

**Interfaces:**
- Produces `partitionHistoricalWindows`, `incrementalWindow`, `runWithRetry`, exported structured TMT client errors, and token-cache reset.

- [ ] Write failing tests for leap/year boundaries, 30-day overlap, transient retry, Retry-After, malformed no-retry, and one auth refresh.
- [ ] Run the targeted test and verify RED for missing interfaces.
- [ ] Implement minimal deterministic date helpers and injected-sleep retry policy; expose only the client error metadata required by the policy.
- [ ] Run targeted client/sync tests and verify GREEN.

### Task 2: Idempotent persistence and transactional checkpoints

**Files:**
- Create: `src/modules/tmt/persistence.ts`
- Create: `tests/tmt-v2-persistence-mysql.test.ts`

**Interfaces:**
- Produces `TmtSyncRepository` with run/checkpoint lifecycle, endpoint cursor queries, chunked endpoint persistence, temporal latest/conflict helpers, and transaction-bound checkpoint success.

- [ ] Write guarded MySQL tests for level newer/same/older behavior, conflicts, temporal preservation, duplicate TPP/relationship replay, MasterTMT raw status, and rollback before checkpoint.
- [ ] Run against the isolated local test database and verify RED.
- [ ] Implement endpoint-specific fixed SQL with 500-row chunks and deterministic in-memory deduplication; never build identifiers from external input.
- [ ] Re-run persistence tests and verify GREEN.

### Task 3: Full, incremental, resume, and readiness orchestration

**Files:**
- Create: `src/modules/tmt/sync.ts`
- Extend: `tests/tmt-v2-sync.test.ts`
- Extend: `tests/tmt-v2-persistence-mysql.test.ts`

**Interfaces:**
- Produces `runInitialTmtSync`, `runIncrementalTmtSync`, and `resumeTmtSyncRun` using explicit `TmtSyncSource`, `TmtSyncRepository`, clock/sleep/random dependencies.

- [ ] Write failing tests for version binding/drift, endpoint-specific cursors, incomplete-only resume, optional isolation, received/unique/written/duplicate metrics, and no absence prune.
- [ ] Implement sequential endpoint/window orchestration, three-attempt retry, atomic persistence/checkpoint updates, and final version verification.
- [ ] Add one guarded integration resume case proving failed transaction replay on local MySQL.
- [ ] Run targeted unit/integration tests and verify GREEN.

### Task 4: Invariant report and local graph acceptance

**Files:**
- Create: `src/modules/tmt/invariants.ts`
- Create: `tests/tmt-v2-invariants.test.ts`

**Interfaces:**
- Produces `buildTmtInvariantReport` and `verifyTmtGpuAcceptance(pool, "764169")`, returning counts and bounded examples only.

- [ ] Write guarded local MySQL fixtures for level/table mismatch, FSN suffix normalization, dangling/self edges, temporal conflicts, unknown levels/status, MasterTMT/TPU mismatch, and the 764169 graph shape.
- [ ] Run and verify RED.
- [ ] Implement bounded aggregate/example queries and conflict-aware latest enrichment helpers.
- [ ] Run and verify GREEN.

### Task 5: Safe local live backfill runner and evidence

**Files:**
- Create: `scripts/tmt-v2-local-sync.mjs`
- Create: `tests/tmt-v2-local-runner.test.ts`

**Interfaces:**
- Consumes only explicit localhost/test DB variables and an in-memory credential resolved without printing secrets; produces a bounded JSON summary without raw payloads.

- [ ] Write failing guard tests for localhost, exact database, explicit opt-in, and redacted output.
- [ ] Implement a local-only runner that migrates 0001-0015, resolves credential read-only when necessary, installs no route/cron, and invokes the dormant engine sequentially.
- [ ] Run a controlled historical live sync, invariant report, 764169 verification, idempotent replay, and incremental run against `drug_master_tmt_v2_sync_test`.
- [ ] Record only counts/version/duration/retries/warnings; never retain raw API dumps or token.

### Task 6: Regression, documentation, review, and release

**Files:**
- Modify: `docs/superpowers/specs/2026-11-04-tmt-data-model-v2-design.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/SPEC.md` only for permanent sync invariants

- [ ] Run targeted TMT, mapping, export, catalog, schema/migration, and DB-guard regressions.
- [ ] Run the full suite only after proving guarded DB tests skip without opt-in.
- [ ] Run `pnpm typecheck`, `pnpm lint`, and `git diff --check`.
- [ ] Review the complete diff for dormant production behavior, immutable old migrations, secrets, dumps, and temp artifacts.
- [ ] Commit once as `feat: add TMT data model v2 sync engine`.
- [ ] Fetch and verify remote main still equals `b264e25a75170b1c826bcb91e2b4783b3d7345e9`, then normal-push only.
- [ ] Stop after Phase 3 without production migration, manual deployment, or Phase 4 work.
