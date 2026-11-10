# TMT Degraded Full Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-shot, explicitly unverified full TMT sync mode without weakening versioned resume.

**Architecture:** Reuse the existing schema with a distinct mode, terminal status, and run-scoped marker. Enforce an empty TMT target in the repository, route the mode explicitly through the operational runner, and keep versioned resume fail-closed.

**Tech Stack:** TypeScript, Vitest, mysql2, existing Phase 7 CLI/guards.

**Spec:** `docs/superpowers/specs/2026-11-10-tmt-degraded-full-sync-design.md`

## Global Constraints

- No migration or dependency.
- No production reset/sync, TTMT import, flags, or maintenance changes.
- Tests must not load `.env.local` or write production.
- Existing versioned full/incremental/resume behavior must remain unchanged.

## Review Focus

- A non-empty TMT target must fail before run/checkpoint creation.
- An interrupted unverified run must not be resumable.
- No version endpoint call or `tmt_version` observation may occur in degraded mode.
- Optional endpoint failure must fail degraded completion.
- Successful validation must remain `coreReady=false` and visibly unverified.

---

### Task 1: Engine and persistence safety

**Files:**
- Modify: `tests/tmt-v2-sync.test.ts`
- Modify: `src/modules/tmt/sync.ts`
- Modify: `src/modules/tmt/persistence.ts`

**Interfaces:**
- Produces: `runUnverifiedInitialTmtSync(...)`; `TmtUnverifiedSyncStore.assertEmptyForUnverifiedFull()`.

- [ ] Add failing tests for empty-target enforcement, no version calls, all endpoints required, unverified terminal state, and resume rejection.
- [ ] Run targeted tests and verify RED.
- [ ] Implement the minimal engine/repository behavior.
- [ ] Run targeted tests and verify GREEN.

### Task 2: Explicit operational mode and validation

**Files:**
- Modify: `tests/tmt-v2-runner.test.ts`
- Modify: `src/modules/phase7/tmt-runner.ts`
- Modify: `scripts/tmt-v2-sync.ts`

**Interfaces:**
- Consumes: `runUnverifiedInitialTmtSync(...)`.
- Produces: CLI mode `full-unverified` routed only to the degraded engine.

- [ ] Add failing dispatch and guard tests and verify RED.
- [ ] Add the explicit runner/CLI mode and GPU `764169` validation.
- [ ] Run targeted tests and verify GREEN.

### Task 3: Documentation and quality gates

**Files:**
- Modify: `docs/SPEC.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/PROJECT_STATUS.md`

- [ ] Record permanent rules and the non-executed production state.
- [ ] Run targeted tests, typecheck, lint, and `git diff --check`.
- [ ] Review the complete diff, commit once, fetch/verify ancestry, and push normally.
