# TMT/TTMT Data Model v2 Phase 6 Implementation Plan

**Spec:** `docs/superpowers/specs/2026-11-04-tmt-data-model-v2-design.md` and the approved Phase 6 brief.

**Global constraints:** keep legacy production behavior as the default; do not use `.env.local`, production, or `jhcisdb`; do not add migration 0017 unless a proven schema defect blocks correctness; preserve the 22-column writer and existing review/checkpoint semantics.

## Task 1: Consumer resolver and feature gates

- Add explicit catalog/export v2 flags, both default OFF.
- Add a source-aware normalized consumer resolver for TMT TPU and TTMT product identities.
- Resolve TMT fields from MasterTMT with latest NLEM/RegNo enrichment; conflicts are deterministic warnings, never arbitrary picks.
- Resolve TTMT fields only from TTMT tables.
- Add RED→GREEN unit tests for namespaces, eligibility, NLEM, RegNo and ATC policy.

## Task 2: Catalog lifecycle and summaries

- Add a v2 reconcile path that validates source/code/level and never overwrites manual mappings.
- Route reconcile through the v2 path only when its explicit flag is enabled.
- Apply v2 standard eligibility to lifecycle, review acknowledgement validity and export-ready summaries without changing feature-OFF queries.
- Add RED→GREEN targeted tests for GPU rejection, catalog changes, invalidation and tenant scope.

## Task 3: Export adapter and consistency

- Add a v2 export candidate builder that batches v2 resolution and reuses the existing row/writer contract.
- Select it only when the explicit export flag is enabled.
- Preserve delta versioning on mapping `updatedAt`, checkpoint transactions, failed-export rollback and one-time preview tokens.
- Include source/code/level and resolved row state in preview consistency.
- Add RED→GREEN tests for full/delta, stale preview identity, same numeric cross-source codes and invalid standards.

## Task 4: Isolated MySQL E2E and workbook verification

- Use only `drug_master_export_v2_test` on localhost with migrations 0001–0016.
- Seed TMT GPU 764169 + TPU 565818, TTMT 565818, catalog/mapping/review/checkpoint fixtures.
- Verify catalog → mapping → preview/export → checkpoint → delta → invalidation, rollback and facility isolation.
- Generate and round-trip the actual workbook; open it with a real spreadsheet application.
- Run the safe full suite with explicit test DB guards and no `.env.local` fallback.

## Task 5: Documentation, quality gates and release checkpoint

- Update SPEC, PROJECT_STATUS, DEVELOPMENT and OPERATIONS with actual behavior and Phase 7 prerequisites only.
- Review the whole diff for legacy isolation, security and N+1 behavior.
- Run targeted tests, full safe suite, typecheck, lint and diff check.
- Commit once as `feat: integrate TMT v2 catalog and export`.
- Fetch `origin/main`, verify it descends from `52f8b7bf35edb4b493efa292e5de200291945e50`, push normally and stop.

## Review focus

- Feature OFF must never query columns/tables absent from production migrations.
- TMT and TTMT namespaces must remain independent even for identical numeric codes.
- GPU 764169 must never be emitted; selected TPU 565818 must be emitted.
- External standard sync timestamps must not affect delta checkpoints.
- RegNo/ATC conflicts must not be resolved arbitrarily.
- No facility identifier may come from an unverified client input.
