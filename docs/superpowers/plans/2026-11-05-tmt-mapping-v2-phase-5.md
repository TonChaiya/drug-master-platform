# TMT/TTMT Mapping v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default-off, source-specific TMT/TTMT mapping path without changing legacy mapping, catalog, or export runtime behavior.

**Architecture:** Add nullable v2 identity columns to `drug_mappings`; keep every existing legacy query untouched. A new gated route validates a source-specific identity against the v2 tables and persists it atomically, while a small gated UI uses the existing TMT Browser data. Lifecycle receives optional standard-validity input without changing legacy callers.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM, MySQL/TiDB, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-tmt-data-model-v2-design.md`

## Global Constraints

- Create only additive migration `0016_mapping_v2_identity.sql`; never edit `0001`–`0015`.
- `TMT_V2_MAPPING_ENABLED` is off unless exactly `1`; default paths query no v2 mapping columns/tables.
- Do not use `.env.local`, `jhcisdb`, production DB, production migration, or manual deployment.
- Do not alter the legacy save, catalog reconcile, or export code paths.
- Validate all public input with Zod and use session-derived facility scope.
- PRODUCTCAT 1 requires active TMT TPU; PRODUCTCAT 2/4 remain fail-closed; TTMT uses its own native product contract.

## Review Focus

- A numeric TMT code whose requested level differs from `tmt_concept.level_name` is rejected rather than coerced.
- A GPU remains visible, but cannot be selected/saved as a commercial mapping.
- A disabled mapping feature does not construct the v2 database path.
- A mapping identity edit invalidates a previous review acknowledgement through DB `updated_at`.
- A same-code TTMT and TMT identity remain distinct through explicit source/level.

---

### Task 1: Migration, identity types, and resolver

**Files:**
- Create: `src/db/migrations/0016_mapping_v2_identity.sql`
- Modify: `src/db/schema/mappings.ts`, `src/modules/tmt/feature.ts`
- Create: `src/modules/mappings/v2.ts`
- Test: `tests/mapping-v2.test.ts`, `tests/tmt-v2-schema.test.ts`

**Interfaces:**
- Produces `MappingStandardSource`, `TMT_MAPPING_LEVELS`, `resolveMappingV2Standard()` and `MappingV2RuleError`.

- [ ] Write failing resolver/schema tests for active TPU, GPU/GP/TP rejection, missing/unknown MasterTMT, level mismatch, and active/inactive TTMT.
- [ ] Run the focused tests and verify they fail because the v2 resolver/schema does not exist.
- [ ] Add nullable identity columns and indexes; implement the source-specific resolver without routing TTMT through TMT or legacy standard tables.
- [ ] Re-run focused resolver/schema tests and verify they pass.

### Task 2: Gated v2 persistence and lifecycle validity

**Files:**
- Create: `src/modules/mappings/v2-service.ts`
- Create: `src/app/api/v1/mappings/v2/route.ts`
- Modify: `src/modules/mappings/lifecycle.ts`
- Test: `tests/mapping-v2-service.test.ts`, `tests/mapping-v2-api.test.ts`, `tests/mapping-lifecycle.test.ts`

**Interfaces:**
- Consumes `resolveMappingV2Standard()`.
- Produces `saveV2Mapping()` and a `POST /api/v1/mappings/v2` contract.

- [ ] Write failing tests for session facility isolation, malformed identity, v2 audit identity, valid lifecycle, invalid standard lifecycle, and acknowledgement staleness after identity change.
- [ ] Run focused tests and verify they fail because the route/service is absent.
- [ ] Implement a gated Zod-validated v2 save transaction, preserving legacy service behavior and using stored DB `updatedAt` for acknowledgement semantics.
- [ ] Re-run focused tests and verify they pass.

### Task 3: Gated mapping chooser

**Files:**
- Create: `src/components/mappings/v2-standard-picker.tsx`
- Modify: `src/app/(dashboard)/mappings/mapping-workbench.tsx`, `src/app/(dashboard)/mappings/page.tsx`
- Test: `tests/mapping-v2-ui.test.tsx`

**Interfaces:**
- Consumes existing TMT Browser search/detail routes and the v2 save API.
- Produces a default-off picker with separate TMT and TTMT presentation.

- [ ] Write failing UI tests for a visible disabled GPU, selectable active TPU, readable Thai reason, and separate TTMT source presentation.
- [ ] Run focused UI tests and verify they fail before the picker exists.
- [ ] Add only the gated picker path; reuse the legacy worklist and leave the default StandardSearch route unchanged while the gate is off.
- [ ] Re-run focused UI tests and verify they pass.

### Task 4: Local migration/integration coverage and documentation

**Files:**
- Modify: `tests/tmt-v2-migration-mysql.test.ts`, relevant mapping/export regression tests
- Modify: `docs/superpowers/specs/2026-11-04-tmt-data-model-v2-design.md`, `docs/PROJECT_STATUS.md`, `docs/DEVELOPMENT.md`, `docs/OPERATIONS.md`, `docs/SPEC.md`

- [ ] Write failing integration tests for clean `0001`–`0016` migration, nullable legacy rows, v2 TMT/TTMT identities, and feature-off legacy regression.
- [ ] Run focused integration tests and verify they fail for the missing migration/contract.
- [ ] Add safe local-only migration coverage and document activation prerequisites, dormant state, and unresolved PRODUCTCAT 2/4 rules.
- [ ] Run the specified targeted tests, `pnpm typecheck`, `pnpm lint`, and `git diff --check`.

### Task 5: Review and release preparation

**Files:**
- Modify only files required by review fixes.

- [ ] Self-review the complete diff against the Phase 5 acceptance criteria, including secret scan and legacy dependency boundaries.
- [ ] Run final relevant tests and quality gates.
- [ ] Fetch `origin/main`; if it does not descend from the approved baseline, stop safely.
- [ ] Commit `feat: add TMT and TTMT mapping v2`, push only after all gates pass, and report without production actions.

## Self-Review

The plan maps identity, source-specific validation, save/API/UI, lifecycle acknowledgement invalidation, migration, local integration, legacy isolation, documentation, and release verification to separate tasks. PRODUCTCAT 2/4 remains explicitly fail-closed. The v2 UI is deliberately additive and gated to keep production queries unchanged until Phase 7 cutover.
