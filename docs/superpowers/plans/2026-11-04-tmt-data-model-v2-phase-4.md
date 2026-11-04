# TMT Data Model v2 Phase 4 Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a feature-gated TMT v2 search and hierarchy browser with safe eligibility preview, bounded graph traversal, and the verified `764169` experience while production remains on legacy standards/mapping/export paths.

**Architecture:** Keep the feature dormant behind `TMT_V2_BROWSER_ENABLED=1`. Search starts from indexed `tmt_concept` identity/normalized FSN and hydrates bounded results from level/MasterTMT tables; graph traversal uses bounded application-side BFS over indexed `concept1`/`concept2` queries. Authenticated API routes validate every query with Zod and check the feature gate before any v2 query. A hidden `/admin/tmt-v2` page renders a compact client workspace but is not added to production navigation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, mysql2 parameterized SQL, Zod, Tailwind CSS 4, Vitest, Laragon MySQL 8.

**Spec:** `docs/superpowers/specs/2026-11-04-tmt-data-model-v2-design.md`

## Global Constraints

- Feature flag defaults OFF; disabled page/routes must not query v2 tables.
- Production migrations 0014/0015 remain unapplied and production consumers remain legacy.
- Search is global TMT master data but every route requires a valid authenticated session.
- Exact/prefix/name search, level/status/eligibility/manufacturer filters, and limits are bounded; no FULLTEXT or unbounded scan/traversal.
- Graph preserves `concept1 -> concept2`, default depth 2, hard depth 4, hard node cap 200, with visited/cycle/self-edge protection.
- Mapping eligibility is preview-only: commercial mapping accepts only TPU with MasterTMT `status=0`; no save endpoint is called.
- GP/GPU/TP/TPU use owner-approved red/green/yellow/blue markers plus text badges; other levels remain neutral and textual.
- No dependency, production DB write, production migration, navigation cutover, mapping/export/catalog/TTMT change, or manual deploy.
- DB integration tests use only `127.0.0.1:3307` and exact database `drug_master_tmt_v2_browser_test` under the fail-closed guard.
- Migrations 0001-0015 are immutable; prefer no 0016 unless an EXPLAIN-proven index defect blocks acceptance.

## Approaches

- **Chosen: isolated authenticated API + hidden feature-gated page.** Exercises the actual browser contract locally while remaining inert in production.
- Components/services only: safest runtime footprint, but cannot verify route validation, auth, or end-to-end browser behavior required by Phase 4.
- Replace legacy standards search: rejected because production lacks v2 tables and mapping/export cutover belongs to later phases.

## Review Focus

- Feature OFF must short-circuit before service construction or any `tmt_*` query.
- Numeric exact/prefix and normalized text search must be bounded and exact ID must rank first.
- Dangling/self/cyclic edges must remain visible as warnings without unbounded recursion.
- Latest-date enrichment conflicts must expose every value and never choose an arbitrary winner.
- Unknown/missing MasterTMT status must remain searchable but ineligible; no absence-based inactive inference.

---

### Task 1: Browser contracts, presentation, feature gate, and eligibility

**Files:**
- Create: `src/modules/tmt/browser.ts`
- Create: `src/modules/tmt/feature.ts`
- Create: `src/modules/tmt/presentation.ts`
- Create: `src/components/tmt/tmt-level-badge.tsx`
- Create: `tests/tmt-v2-browser.test.ts`
- Create: `tests/tmt-v2-browser-ui.test.ts`

**Interfaces:**
- Produces known level/status/result/detail types, `mappingEligibility`, `tmtV2BrowserEnabled`, `TMT_LEVEL_PRESENTATION`, and `TmtLevelBadge`.

- [ ] Write failing unit tests for eligibility states, default-off gate, four approved marker colors, neutral unknown levels, text badges, and decorative `aria-hidden` markers.
- [ ] Run targeted tests and verify RED for missing interfaces.
- [ ] Implement the minimal pure contracts/presentation helpers and badge component.
- [ ] Run targeted tests and verify GREEN.

### Task 2: Indexed search service and local fixture

**Files:**
- Create: `src/modules/tmt/search.ts`
- Create: `tests/helpers/tmt-v2-browser-fixture.ts`
- Create: `tests/tmt-v2-browser-mysql.test.ts`

**Interfaces:**
- Produces `searchTmt(pool, filters)` and bounded result hydration with endpoint/MasterTMT/status/relationship summary.

- [ ] Write guarded MySQL tests for exact ID, prefix, normalized FSN, level, manufacturer, active/eligibility, optional enrichment filters, exact-first ranking, limits, empty results, and unknown stored levels.
- [ ] Add EXPLAIN assertions for exact PK access and bounded indexed filter paths; verify RED.
- [ ] Implement parameterized search, prefix ranges, candidate intersections, bounded hydration, and data-quality warnings without changing schema.
- [ ] Run the guarded search tests and verify GREEN.

### Task 3: Concept detail, enrichment, and bounded graph

**Files:**
- Create: `src/modules/tmt/graph.ts`
- Create: `src/modules/tmt/detail.ts`
- Extend: `tests/tmt-v2-browser-mysql.test.ts`

**Interfaces:**
- Produces `loadDirectTmtRelationships`, `traverseTmtGraph`, and `getTmtConceptDetail` with direct neighbors, related TPU summaries, latest temporal sets, eligibility, and warnings.

- [ ] Add failing fixture tests for inbound/outbound direction, `764169` 1/9/3 shape, multi-parent, GPP/TPP self-level edges, self edge, cycle, dangling concept, depth/node caps, MasterTMT detail, latest NLEM, ATC/RegNo conflicts, and missing enrichment.
- [ ] Implement indexed direct-edge reads and application BFS with visited/depth/node bounds.
- [ ] Implement detail composition reusing Phase 3 latest-temporal helpers and search hydration.
- [ ] Run guarded browser tests and verify GREEN.

### Task 4: Authenticated feature-gated API routes

**Files:**
- Create: `src/app/api/v1/tmt-v2/search/route.ts`
- Create: `src/app/api/v1/tmt-v2/concepts/[id]/route.ts`
- Create: `tests/tmt-v2-browser-routes.test.ts`

**Interfaces:**
- Produces authenticated GET routes with Zod-bounded query/id/depth/node validation and generic disabled/error responses.

- [ ] Write failing route tests for unauthenticated denial, default-off no-query behavior, malformed query/id/depth/limit rejection, and successful bounded service calls.
- [ ] Implement auth then gate then validation/service flow; never accept facility scope or expose DB/credential details.
- [ ] Run route tests and verify GREEN.

### Task 5: Hidden responsive browser workspace

**Files:**
- Create: `src/app/(dashboard)/admin/tmt-v2/page.tsx`
- Create: `src/app/(dashboard)/admin/tmt-v2/tmt-browser.tsx`
- Extend: `tests/tmt-v2-browser-ui.test.ts`

**Interfaces:**
- Consumes the isolated APIs and presentation source; produces compact search/results/detail/relationship/GPU-to-TPU navigation with no mutation.

- [ ] Write failing UI contract tests for Thai labels, filters, eligibility copy, level badges, and absence of mapping-save actions.
- [ ] Implement disabled server state that performs no v2 query and an enabled client workspace with stale-response protection and no full-page reload.
- [ ] Render direct relationships as previous/next with the `concept1 -> concept2` hint and related TPU preview rows.
- [ ] Run UI tests and React quality review; verify GREEN.

### Task 6: Local visual verification, regressions, documentation, and release

**Files:**
- Modify: `docs/superpowers/specs/2026-11-04-tmt-data-model-v2-design.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/SPEC.md`
- Modify: `.env.example` only if the flag placeholder pattern permits it without exposing a value.

**Interfaces:**
- Produces verified local visual evidence, activation prerequisites, regression evidence, one commit, and one normal push.

- [ ] Run local browser against deterministic `764169` fixture and inspect desktop/mobile search, results, detail, long text, empty enrichment, overflow, keyboard focus, and no mutation.
- [ ] Run targeted browser/API/Phase 3/parser/schema/migration/mapping/export regressions, then the safe full suite.
- [ ] Run `pnpm typecheck`, `pnpm lint`, and `git diff --check`; inspect staged diff for secrets, legacy changes, migration edits, and accidental navigation/production activation.
- [ ] Update docs with actual behavior and prerequisites while keeping production inactive.
- [ ] Commit once as `feat: add TMT v2 search and hierarchy browser`.
- [ ] Fetch and verify remote descends from `18ad6f5d4a74709388a16baf5a581b34174adc01`, normal-push only, and stop before Phase 5.
