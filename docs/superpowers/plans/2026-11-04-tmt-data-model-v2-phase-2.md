# TMT/TTMT Data Model v2 Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the unused, additive TMT/TTMT v2 persistence and typed API parser/client foundation without cutting over any production consumer.

**Architecture:** Keep legacy `standard_*` tables and services untouched while adding endpoint-named TMT tables, isolated TTMT tables, and validated API adapters. Migrations 0014/0015 are additive and verified only against a dedicated local Laragon MySQL database.

**Tech Stack:** TypeScript strict, Drizzle ORM/MySQL, Zod, Vitest, MySQL 8-compatible SQL.

**Spec:** `docs/superpowers/specs/2026-11-04-tmt-data-model-v2-design.md`

## Global Constraints

- Additive foundation only; no production migration, deployment, reset, cutover, or production data write.
- Preserve all legacy `standard_products`, mapping, export, catalog, and TTMT importer runtime paths.
- Use exact owner-approved TMT table names and separate TTMT namespace.
- TMT database identifiers are `BIGINT UNSIGNED`; application/parser identifiers are strings.
- No DB enums, triggers, stored procedures, FULLTEXT, new dependency, real credential, token, or live bulk fixture.
- Migrations 0001-0013 are immutable.
- Work directly on `main` because the owner explicitly requires normal push from `main` after all gates pass.

## Review Focus

- A numeric identifier above JavaScript safe integer range must remain exact as a string at the parser boundary.
- Malformed roots, missing required fields, and wrong field types must fail closed with sanitized errors.
- Temporal NLEM/ATC/registration values must not collide or overwrite distinct same-date values.
- Endpoint tables must not gain foreign keys that impose ingestion ordering.
- New schema exports must not change any legacy consumer or production query path.

---

### Task 1: TMT/TTMT schema and additive migrations

**Files:**
- Create: `tests/tmt-v2-schema.test.ts`
- Create: `src/db/schema/tmt.ts`
- Create: `src/db/schema/ttmt.ts`
- Create: `src/db/migrations/0014_tmt_data_model_v2.sql`
- Create: `src/db/migrations/0015_ttmt_data_model_v2.sql`
- Modify: `src/db/schema/index.ts`

**Interfaces:**
- Produces exact Drizzle tables exported through `@/db/schema` and matching additive SQL migrations.
- Preserves all legacy exports and tables.

- [ ] Write schema contract tests for table names, columns, keys/indexes, separate TMT/TTMT code namespaces, temporal identities, no ingestion-order FK, and no legacy DDL mutation.
- [ ] Run `pnpm exec vitest run tests/tmt-v2-schema.test.ts` and verify RED because v2 schema/migrations do not exist.
- [ ] Add minimal Drizzle schema and migrations 0014/0015.
- [ ] Re-run the schema contract test and verify GREEN.

### Task 2: Typed parsers and 18-endpoint client foundation

**Files:**
- Create: `tests/tmt-api-client.test.ts`
- Create: `src/modules/standards/tmt-parsers.ts`
- Modify: `src/modules/standards/tmt-client.ts`

**Interfaces:**
- Produces typed records and parser functions for token, 15 source endpoints, image, and version.
- Client methods continue using the existing credential resolver and memory-only raw bearer token.

- [ ] Write synthetic parser/client contract tests for all 18 endpoints, malformed roots, missing IDs, wrong types, empty data, nullable text, future level values, duplicate TPP determinism, relationship direction, status 0/1, and sanitized errors.
- [ ] Run `pnpm exec vitest run tests/tmt-api-client.test.ts` and verify RED for missing parser/client surface.
- [ ] Implement the smallest shared Zod parser primitives and endpoint methods without altering existing call signatures.
- [ ] Re-run parser/client tests and current standards regression tests that exercise the existing client behavior.

### Task 3: Controlled local migration verification

**Files:**
- Create: `tests/tmt-v2-migration-mysql.test.ts`

**Interfaces:**
- Consumes migrations 0001-0015 against the exact dedicated database `drug_master_tmt_v2_test` on `127.0.0.1`.
- Produces evidence for clean migrate, journal hashes, indexes/keys, and idempotent rerun; never reads `.env.local`.

- [ ] Write guarded MySQL integration test requiring `TMT_V2_TEST_DATABASE=drug_master_tmt_v2_test` and localhost.
- [ ] Run it before provisioning and verify the expected RED/precondition failure.
- [ ] Create only the dedicated local database, run migrations through the test harness, and verify journal/schema/rerun behavior.
- [ ] Confirm no connection or database name can target production or `jhcisdb`.

### Task 4: Documentation truth update

**Files:**
- Modify: `docs/superpowers/specs/2026-11-04-tmt-data-model-v2-design.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/SPEC.md`

**Interfaces:**
- Records implemented Phase 2 schema/parser truth, unapplied production migrations, rollback notes, local verification workflow, and Phase 4 color-plus-text browser markers.

- [ ] Update only permanent requirements, implementation status, migration/local test instructions, and rollback notes.
- [ ] State explicitly that production remains on legacy tables and Phase 3 is next.

### Task 5: Verification, review, commit, and push

**Files:** all Phase 2 changes only.

- [ ] Run targeted parser, schema, migration, and relevant standards/TTMT regression tests.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `git diff --check`.
- [ ] Search staged diff for secrets, live dumps, environment files, legacy migration edits, and cutover changes.
- [ ] Perform final whole-diff review against Phase 2 acceptance criteria and fix only verified Critical/Important findings via RED-GREEN.
- [ ] Commit once as `feat: add TMT and TTMT data model v2 foundation`.
- [ ] Verify remote `main` has not moved, push normally, and verify final HEAD/status.
- [ ] Stop without deployment, production migration, data reset, or Phase 3 work.
