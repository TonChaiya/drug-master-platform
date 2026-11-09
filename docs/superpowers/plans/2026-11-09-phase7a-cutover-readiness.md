# Phase 7A Cutover Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add locally verified, fail-closed Phase 7 operational tooling without writing to production or enabling v2 features.

**Architecture:** Keep the Phase 3 sync engine and v2 schemas as the source of truth. Add a persistent maintenance state in the existing encrypted `app_settings` table, shared operational target guards, production-intended CLIs with dry-run defaults, and a v2-only TTMT importer. Route-level maintenance enforcement blocks domain mutations before their existing services run.

**Tech Stack:** TypeScript, Node.js, `tsx`, Drizzle/mysql2, zod, Vitest, existing Excel reader and TMT sync engine.

**Spec:** `docs/superpowers/specs/2026-11-04-tmt-data-model-v2-design.md`

## Global Constraints

- Production is SELECT-only during Phase 7A; migrations remain through 0013 and all v2 flags remain OFF.
- Never use `jhcisdb`, fabricate MasterTTMT data, or run test-only harnesses against production.
- Operational writes require explicit environment, execute, DB confirmation, migration, maintenance, and fingerprint gates.
- Dry-run is the default and must perform zero writes.
- Keep tables are hard-denied by reset tooling; no database/schema/table drops.

## Review Focus

- Production guard must reject local, unknown, `jhcisdb`, wrong port/version/host, missing migration, and maintenance OFF.
- Malformed maintenance state must fail closed for domain mutations without blocking login/read-only routes.
- TTMT duplicate codes or replayed version/hash must not create partial import state or touch legacy/TMT tables.
- Agent sync must receive 503 before begin/batch/finish mutations so retry is safe.
- Reset failure must roll back all deletes and preserve every KEEP table count.

---

### Task 1: Shared operational guards and maintenance boundary

**Files:**
- Create: `src/modules/maintenance/service.ts`, `src/modules/maintenance/route-guard.ts`, `src/modules/phase7/guards.ts`, `scripts/phase7-maintenance.ts`
- Modify: mutation routes for Agent sync, catalog, mapping/reconcile, standards import/sync, export preview/download; `package.json`
- Test: `tests/phase7-guards.test.ts`, `tests/maintenance.test.ts`, `tests/maintenance-routes.test.ts`

- [x] Write failing tests for target guards, encrypted persistent state, audited idempotent transitions, fail-closed route response, and blocked domain handlers.
- [x] Implement the smallest shared guard/state modules and CLI; add route guards before domain mutations.
- [x] Run targeted maintenance/route tests and typecheck.

### Task 2: TTMT v2 parser, importer, and CLI

**Files:**
- Create: `src/modules/standards/ttmt-parser.ts`, `src/modules/standards/ttmt-v2-import.ts`, `scripts/ttmt-v2-import.ts`
- Modify: `src/modules/standards/ttmt-import.ts`, `package.json`
- Test: `tests/ttmt-v2-import.test.ts`, `tests/ttmt-v2-import-mysql.test.ts`

- [x] Write failing parser/import tests for dry-run, hash/version, malformed/duplicate rows, active/inactive, replay, transactionality, and namespace isolation.
- [x] Extract the proven legacy parser contract and implement v2-only transactional persistence.
- [x] Add guarded dry-run/execute CLI and run targeted tests.

### Task 3: Production-safe TMT v2 runner

**Files:**
- Create: `src/modules/phase7/tmt-runner.ts`, `scripts/tmt-v2-sync.ts`
- Modify: `package.json`
- Test: `tests/tmt-v2-runner.test.ts`, `tests/tmt-v2-runner-mysql.test.ts`

- [x] Write failing tests for dry-run zero writes, guards, full/incremental/resume dispatch, core readiness, and version drift.
- [x] Reuse the Phase 3 source/repository/sync functions behind guarded operational orchestration.
- [x] Run targeted runner and Phase 3 regression tests.

### Task 4: Read-only preflight and controlled reset tooling

**Files:**
- Create: `src/modules/phase7/inventory.ts`, `src/modules/phase7/reset.ts`, `scripts/phase7-preflight.ts`, `scripts/phase7-reset.ts`
- Modify: `package.json`
- Test: `tests/phase7-preflight.test.ts`, `tests/phase7-reset.test.ts`, `tests/phase7-readiness-mysql.test.ts`

- [x] Write failing tests for blocker reporting, exact allowlist/denylist, dry-run zero writes, execute confirmation, rollback, empty retained legacy tables, and KEEP preservation.
- [x] Implement SELECT-only preflight and transactional explicit DELETE reset.
- [x] Run guarded local MySQL E2E through migrations 0001–0016.

### Task 5: Regression, documentation, final review, commit and push

**Files:**
- Modify: `docs/PROJECT_STATUS.md`, `docs/OPERATIONS.md`, `docs/DEVELOPMENT.md`, `docs/SPEC.md`

- [x] Run targeted suites, safe full suite, `pnpm typecheck`, `pnpm lint`, and `git diff --check`.
- [x] Reconfirm production read-only state: writes 0, migration 0013, flags OFF, no secrets or backup in Git.
- [x] Document commands, maintenance semantics, rollback, missing production MasterTTMT file, and cutover prerequisites.
- [x] Review the complete diff, fetch expected remote baseline, commit `feat: add Phase 7 cutover readiness tooling`, and push normally.
