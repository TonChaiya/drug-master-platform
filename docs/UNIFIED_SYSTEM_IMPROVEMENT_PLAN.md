# Drug Master Platform — Unified System Improvement Plan

**Project:** `TonChaiya/drug-master-platform`
**Baseline:** `49f97c7` · Application `0.5.0`
**Scope:** 6 Phases · Controlled Implementation
**Status:** Documentation handoff only; Phase 1 is not approved.

## Primary objective

Improve Drug Master Platform as one complete, easy-to-use system without losing existing capabilities during UX/UI work.

Mandatory principles:

- Use the current TMT/TTMT system as the primary data source.
- Do not run duplicate old and new workflows.
- Do not show `V1`, `V2`, or `Legacy` as system names or menus to users.
- Technical names in APIs, schema, and migrations may remain when necessary.
- Show the application version from `package.json` only in the shared footer.
- Present TMT/TTMT dataset versions separately from the application version.
- Keep UX/UI compact; do not make cards larger than necessary.
- Preserve production data and important working behavior.

## Phase 1 — System Audit & Baseline

**Scope**

1. Audit every application page for Admin and User roles.
2. Audit APIs, services, schema, feature flags, and dependencies.
3. Compare historical and current capabilities.
4. Identify missing, duplicate, and non-working functionality.
5. Assess TMT/TTMT readiness, Mapping, and Export risks.
6. Produce a Feature Parity Checklist and Regression Baseline.

**Acceptance criteria**

- A complete page/function inventory with current state exists.
- Capabilities that must be restored are identified.
- Risks and relevant files are identified.
- No application code or production state is changed.

**Prohibited:** refactors, migrations, deployment, or remediation of findings in this phase.

## Phase 2 — Data Reliability & Safety

**Scope**

1. Separate the latest sync run from the approved standard-data set.
2. Prevent failed syncs/imports from affecting the approved data set.
3. Review TTMT import and its effect on TMT readiness.
4. Preserve Mapping, Catalog, Export checkpoints, and audit history.
5. Review TMT versions, RegNo, conflicts, and validation.
6. Compare against `TMTRF20261102.zip` read-only when that file is supplied.

**Acceptance criteria**

- A failed sync/import does not damage an accepted data set.
- Existing mappings are neither lost nor overwritten without approval.
- Readiness has an auditable reason and state.
- Relevant regression tests pass.

**Prohibited:** schema changes or production changes without separate approval.

## Phase 3 — Restore Admin Operations

**Scope**

1. Restore starting TMT sync from Admin.
2. Support full/incremental modes only where genuinely supported.
3. Allow date-range selection for supported modes.
4. Show progress, run history, checkpoints, warnings, and errors.
5. Resume only modes that can be resumed safely.
6. Validate Admin role, environment, database, and duplicate-work protections.
7. Use processing independent of a long-lived HTTP request.

**Acceptance criteria**

- An Admin can start and monitor sync through the web UI.
- Accepted work continues after the browser closes.
- Important commands have guards and audit records.
- No legacy sync writes to the old standard-data store.
- Full-unverified is not presented as resumable unless it truly is.

**Prohibited:** creating workers, queues, or new infrastructure without first evaluating existing options and receiving approval.

## Phase 4 — Unified System & Feature Parity

**Scope**

1. Consolidate workflows around one primary system.
2. Consolidate duplicate APIs/services only after parity is proven.
3. Make the Mapping primary path unambiguous.
4. Restore still-required historical functionality.
5. Verify the JHCIS → Standards → Catalog → Mapping → Export flow.
6. Retire unused paths/code only after testing and approval.
7. Preserve Agent and historical-data compatibility where needed.

**Acceptance criteria**

- Normal usage has no duplicate old/new workflow.
- Important functionality does not regress from the baseline.
- APIs and shared data have clear sources of truth.
- Regression tests pass.

**Prohibited:** deleting legacy tables or history merely to make the system names look new.

## Phase 5 — Compact UX/UI Redesign

**Seven primary menus**

| Page | Required retained/improved capabilities |
| --- | --- |
| Dashboard | KPI, readiness, Agent status, outstanding work, quick actions |
| JHCIS | Enrollment, test connection, sync now, Agent management, history |
| Standards | TMT/TTMT search, detail, relationships, status |
| Drug Catalog | Import, validation, diff, snapshot, history |
| Mapping | Worklist, search, filters, pagination, manual mapping, review, reconcile |
| Export | Full/delta, preview, exclusion reasons, download, history |
| Admin | Users, facilities, Agent settings, TMT API/sync, TTMT import, audit |

**UI standards**

- Use a compact, responsive layout.
- Target 12–16 px card padding and primary spacing.
- Target 90–120 px KPI-card height where content permits.
- Do not create large cards for one or two lines of information.
- Use tables and pagination for large data sets.
- Keep filters/search in a compact bar.
- Use expanders, drawers, or modals for advanced detail as appropriate.
- Do not reload the entire page unnecessarily; retain filters and work position where possible.
- Do not expose `V1`, `V2`, or `Legacy` as user-facing system names.
- Display the application version once, in the footer.

**Acceptance criteria**

- Every page supports desktop, tablet, and mobile.
- Required functions remain easy to find and use.
- Whitespace and repetitive copy are reduced.
- Functionality satisfies the Feature Parity Checklist.
- Visual and functional regression checks pass.

## Phase 6 — Verification & Controlled Release

**Scope**

1. Run typecheck, lint, unit, and integration tests.
2. Check Admin/User authorization and facility isolation.
3. Test every page and critical workflow.
4. Test TMT/TTMT sync, import, mapping, and export.
5. Check footer version and user-facing copy.
6. Review Git diff, migration impact, and important data.
7. Prepare rollback and release checkpoints.
8. Deploy only after explicit approval.

**Acceptance criteria**

- Relevant tests pass.
- No important functionality is lost.
- No unresolved data regression remains.
- A practical rollback plan exists.
- Status documentation matches the delivered commit.

## Global scope guard

1. Work only on an explicitly approved phase; never begin a later phase automatically.
2. Do not add features, dependencies, schema, or infrastructure outside scope.
3. Do not change production data, migrations, or deploy without separate approval.
4. Do not remove existing functionality before Feature Parity is confirmed.
5. Do not delete or reset JHCIS, Mapping, Catalog, TMT/TTMT, Export, or Audit data.
6. Prefer suitable existing code to duplicate systems.
7. Check Git status and diff before and after changes.
8. Report and stop on problems outside scope.
9. Do not refactor unrelated files.
10. Every phase requires acceptance criteria and test results.
11. Do not claim production verification without actually performing it.
12. Read only what is needed; do not rescan or produce lengthy reports without reason.

## Reporting format

- `STATUS:` PASS / FAIL / BLOCKED
- `PHASE:` phase number
- `CHANGED_FILES:` file list
- `TESTS:` test results
- `RISKS:` outstanding issues
- `COMMIT:` SHA, if any
- `NEXT:` pending approval

## Handoff boundary

Completion of this documentation handoff does **not** approve implementation. Phase 1 requires a separate explicit start instruction.
