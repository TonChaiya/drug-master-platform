# Validated-Unverified TMT Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist fail-closed evidence for a completed `full_unverified` TMT run and let the central readiness guard recognize it as `validated_unverified`, never as verified.

**Architecture:** Add one validation row per TMT run, created only by an explicitly guarded operational command after checkpoints, invariants, GPU 764169, and the approved TTMT import all pass. Central readiness keeps the existing verified path and adds a degraded path that rechecks the persisted validation identity and current TTMT import. Existing consumers continue to use the central guard.

**Tech Stack:** TypeScript strict, mysql2/Drizzle, Zod, MySQL/TiDB migrations, Vitest.

**Spec:** User-approved Phase 7X request and `docs/SPEC.md` TMT v2 readiness rules.

## Global Constraints

- No production migration, revalidation, feature-flag, or maintenance changes.
- Add migration only; never edit migrations 0001-0016.
- Fail closed for missing, stale, unsupported, or mismatched evidence.
- Preserve `full_unverified` run status/error and label assurance `validated_unverified`.
- TMT-v2-only reset must remove evidence through FK cascade.
- No new dependency and no secret or production data in tests or docs.

## Review Focus

- A validation row whose TTMT import was replaced must be rejected.
- A failed/pending required checkpoint must prevent validation; failed imagelist alone may pass.
- Evidence canonicalization must be deterministic across object/key/query ordering.
- A reset deleting the run must cascade the validation row.
- Enabling a consumer with unsupported policy evidence must still fail with `TMT_V2_NOT_READY`.

---

### Task 1: Migration and evidence contract

**Files:**
- Create: `src/db/migrations/0017_tmt_run_validations.sql`
- Modify: `src/db/schema/tmt.ts`
- Test: `tests/tmt-v2-schema.test.ts`, `tests/tmt-v2-migration-mysql.test.ts`

- [ ] Write schema/migration tests for the required columns, run PK/FK cascade, and migration 0001-0017 idempotency; verify RED.
- [ ] Add the minimal table and Drizzle schema; verify targeted tests GREEN.

### Task 2: Guarded validation and deterministic evidence

**Files:**
- Create: `src/modules/tmt/validation.ts`, `scripts/tmt-v2-validate.ts`
- Modify: `package.json`
- Test: `tests/tmt-v2-validation.test.ts`

- [ ] Write failing tests for run identity, required checkpoints, imagelist-only failures, invariant/GPU failures, approved TTMT identity, deterministic digest, and atomic insert.
- [ ] Implement pure evidence canonicalization plus a guarded DB validator/CLI using explicit environment and operational guards.
- [ ] Run targeted validation tests GREEN.

### Task 3: Central readiness and preflight assurance

**Files:**
- Modify: `src/modules/tmt/readiness.ts`, `src/modules/phase7/inventory.ts`, `scripts/phase7-preflight.ts`
- Test: `tests/tmt-v2-readiness.test.ts`, `tests/phase7-preflight.test.ts`, `tests/phase7-readiness-mysql.test.ts`

- [ ] Write failing tests for verified, valid degraded, missing evidence, wrong policy, TTMT mismatch, and stale checkpoint evidence.
- [ ] Extend readiness with `assurance: verified | validated_unverified`; emit a degraded warning in preflight without a blocker.
- [ ] Run targeted readiness tests GREEN.

### Task 4: Visible degraded UI and reset coverage

**Files:**
- Modify: `src/app/(dashboard)/admin/tmt-v2/page.tsx`, `src/app/(dashboard)/mappings/v2/page.tsx`, `src/modules/phase7/reset.ts`
- Test: relevant browser/UI and reset tests.

- [ ] Write failing presentation/reset tests.
- [ ] Show an explicit degraded notice and include the validation table in reset safety/preservation semantics without adding an extra delete dependency.
- [ ] Run targeted UI/reset tests GREEN.

### Task 5: Documentation, full verification, review, commit and push

**Files:**
- Modify: `docs/SPEC.md`, `docs/OPERATIONS.md`, `docs/DEVELOPMENT.md`, `docs/PROJECT_STATUS.md`

- [ ] Document validation policy, CLI, migration rollback note, degraded assurance, and production-not-applied state.
- [ ] Run targeted tests, local migration integration when guarded DB is available, full safe suite, `pnpm typecheck`, `pnpm lint`, and `git diff --check`.
- [ ] Review the complete diff for secrets, production data, old migration edits, and fail-open paths.
- [ ] Commit once and push normally; confirm HEAD/origin and clean worktree.
