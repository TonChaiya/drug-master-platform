# TMT/TTMT Data Model v2 - discovery, design, and Phase 2 foundation

## Executive summary

Phase 1 mapped the current implementation, verified the owner-provided TMT API manual against the live read-only API, proved TMT ID `764169`, and proposed a replacement data model and cutover plan. Phase 2 implements the additive persistence and parser/client foundation in migrations 0014/0015 without changing production consumers, applying production migrations, or mutating production domain data.

The current application flattens only MasterTMT TPU products and file-imported TTMT products into one `standard_products` table. That is sufficient for today's commercial-product mapping, but it loses the TMT concept graph, permits TMT/TTMT code collisions, cannot show non-TPU concepts, and cannot represent endpoint-specific history such as NLEM, ATC, registration, or relationship changes.

Data Model v2 therefore keeps the manual's endpoint names verbatim (`tmt_subs`, `tmt_vtm`, ..., `tmt_version`), treats `tmt_concept` and `tmt_relationship` as the graph source of truth, treats `tmt_mastertmt` as TPU product-detail/status truth, and moves TTMT to its own namespace. Mapping references become an explicit `(standard_source, standard_code, standard_level)` tuple. No absence-based pruning is allowed until TMT documents deletion/tombstone behavior.

## Phase 1 scope, goals, and non-goals

### Goals

- Verify all 18 manual endpoints, actual roots, fields, types, levels, relationship patterns, and bounded data volumes.
- Prove the identity, level, relationship path, and mapping eligibility implications of `764169`.
- Define source-of-truth and synchronization invariants for every required TMT table.
- Separate TMT and TTMT without preserving compatibility with resettable domain data.
- Define a safe future reset/cutover that preserves login identity, facilities, secrets, security configuration, audit history, and Agent machine identity.
- Give Phase 2 an exact, testable schema/parser scope without starting it.

### Non-goals

- Phase 1 created no migration, schema, production data mutation, reset, deployment, or Phase 2 implementation.
- No assumption that TTMT implements TMT's hierarchy or API contract.
- No attempt to infer a deleted concept/edge from an absent API response.
- No image persistence design in Phase 2; images remain optional/follow-up.

## Evidence and method

- Manual: owner-provided **TMT API** PDF, 26 pages, created 2022-06-03, SHA-256 `8fc6474cb7170853bca50ddd766a7faec8c48cf208dcef108fe1ea4f732d8cda`.
- Live API: `https://tmt.this.or.th/tmtapi`, read-only `POST` calls using the application's encrypted database credential resolver semantics. Token and credentials remained in memory and were never printed or written.
- Live version: `20261102`; `/version` returned HTTP 200 in about 40 ms during the evidence run.
- Historical sampling: sequential, non-overlapping windows of at most 365 days from `2013-01-01` through `2026-11-04`; no concurrent request flood.
- Production database access was read-only and limited to credential resolution and aggregate counts. No domain rows were written.

The manual states field contracts but does not define relationship parent/child semantics, deletion/tombstone semantics, pagination, maximum date-window size, ordering, uniqueness, or whether date boundaries are inclusive. Those remain explicit unknowns even where live data shows a stable pattern.

## Current architecture map

### Implemented TMT API surface

`src/modules/standards/tmt-client.ts` implements:

- `/token`: credential exchange, token cached in process memory, one-minute expiry safety margin.
- `/version`: version validation as eight digits.
- `/mastertmt`: TPU product detail parser.
- `/nlem`: NLEM parser keyed by `tpuid`.
- `/regno`: registration parser keyed by `tpuid`.

No client/parser currently exists for `/subs`, `/vtm`, `/gp`, `/gpu`, `/gpp`, `/tp`, `/tpu`, `/tpp`, `/imagelist`, `/image`, `/atc`, `/concept`, or `/relationship`.

### Current persistence and sync

- `standard_products` stores both TMT and TTMT rows. `standard_code` is globally unique, so equal TMT/TTMT codes cannot coexist safely.
- TMT rows are TPU-only records from `/mastertmt`; `/nlem` and `/regno` overwrite enrichment columns on the same row.
- TTMT comes from an approved spreadsheet through `src/modules/standards/ttmt-import.ts` and is upserted into the same table.
- `standard_imports` stores TTMT import metadata; `standard_sync_runs` stores TMT run/window progress.
- Initial TMT sync starts at `2013-01-01`, partitions by at most 365 days, and runs in two passes: MasterTMT first, then NLEM/registration enrichment.
- Incremental sync starts 30 days before the most recent successful end date. If a new MasterTMT product appears, enrichment widens back to full history.
- Resume state is one run, phase (`master`/`enrich`), and next date window. Successful windows mutate the current table immediately; a whole-run staging snapshot is not used.
- Chunk size is 500 for product upserts and 1,000 for enrichment updates.

### Current consumers and dependency graph

```text
TMT /mastertmt + /nlem + /regno ─┐
                                  ├─> standard_products <─ TTMT spreadsheet import
                                  │          │
                                  │          ├─> standards search / counts / readiness
                                  │          ├─> mapping save eligibility
Drug Catalog latest snapshot ─────┼──────────┤
JHCIS source_drugs ────────────────┘          ├─> catalog reconcile + lifecycle/status
                                             ├─> dashboard/admin summaries
                                             └─> export rows (names, strength, content,
                                                 manufacturer, ISED, registration validity)
```

Specific dependencies affected in Phases 2-6:

- `src/modules/standards/tmt-client.ts`: expand parsers/contracts for all endpoints.
- `src/modules/standards/sync.ts`: replace the combined TPU sync with endpoint-specific checkpoints and tables.
- `src/modules/standards/search.ts` and `src/components/standard-search.tsx`: search all concepts, display level/status/eligibility, and traverse relationships.
- `src/modules/standards/ttmt-import.ts`: write TTMT-only import/current tables.
- `src/modules/mappings/service.ts`: validate source, level, code, product category, and current eligibility.
- `src/modules/mappings/queries.ts`, `summary.ts`, and `lifecycle.ts`: join source-specific standards without changing catalog lifecycle semantics.
- `src/modules/exports/rows.ts`: resolve export fields from TMT/TTMT source-specific tables and continue excluding invalid mappings.
- `src/modules/catalog/*`: reconcile the catalog TMTID against source-specific eligibility rather than the mixed table.
- standards/admin/dashboard API routes and pages: readiness/counts must come from new sync/import truth.

### Current correctness gaps

- Non-TPU concepts cannot be searched or explained.
- Relationship direction, multi-hop browsing, and pack hierarchy are absent.
- A GPU code can look like a missing product rather than a valid non-eligible concept.
- TMT and TTMT share a global code namespace and one lifecycle/status shape without evidence they are equivalent.
- NLEM/registration history is overwritten; ATC is not stored.
- Mapping validity checks only `standard_type` + active status, not concept level.
- `standard_products` has three more active TMT rows in production than the live `20261102` MasterTMT response (34,490 versus 34,487), demonstrating why cutover should rebuild rather than infer deletion from the old table.
- There are no targeted standards/TMT parser or sync tests in the current `tests/` tree.

## Manual endpoint contract and live cross-check

All endpoints use TLS 1.2 and JSON. `/token` has no bearer header; every other endpoint uses the raw token as `Authorization: Bearer <token>`.

| Endpoint | Input | Manual/live response | Level/status semantics | `change_date` | Live result |
|---|---|---|---|---:|---|
| `/token` | `{username,password}` | root `success,create,expire,token`; strings | authentication only | no | 200; contract matched |
| `/subs` | `{begindate,enddate}` | `data[]`: `subsid` number, `fsn` string, `change_date` string | SUBS | yes | 2,552 unique |
| `/vtm` | dates | `vtmid`, `fsn`, `change_date` | VTM | yes | 3,142 unique |
| `/gp` | dates | `gpid`, `fsn`, `change_date` | GP | yes | 9,015 unique |
| `/gpu` | dates | `gpuid`, `fsn`, `change_date` | GPU | yes | 10,948 unique |
| `/gpp` | dates | `gppid`, `fsn`, `change_date` | GPP | yes | 8,070 unique |
| `/tp` | dates | `tpid`, `fsn`, `manufacturer`, `change_date` | TP | yes | 32,025 unique |
| `/tpu` | dates | `tpuid`, `fsn`, `manufacturer`, `change_date` | TPU | yes | 34,487 unique |
| `/tpp` | dates | `tppid`, `fsn`, `manufacturer`, `change_date` | TPP | yes | 12,792 rows / 12,747 IDs; 45 exact duplicate rows |
| `/imagelist` | dates | `tpuid`, `fsn`, `change_date` | TPU image-change list | yes | partial 4,092 rows; three windows returned 500 |
| `/image` | `{tpuid}` | `data[]`: TPU `tpuid,fsn,pill,pills`; nested packs with TPP and six image faces | no lifecycle status | no | 200 for one bounded sample; 602-byte response |
| `/nlem` | dates | `tpuid`, `fsn`, `nlem`, `change_date` | TPU enrichment | yes | 47,071 rows / 34,471 IDs; values change over time |
| `/atc` | dates | `tpuid`, `fsn`, `atc`, `change_date` | TPU enrichment; manual description says “TAC” but field is `atc` | yes | 39,096 rows / 33,459 IDs |
| `/regno` | dates | `tpuid`, `fsn`, `regno`, `change_date` | TPU enrichment | yes | 14,714 rows / 13,591 IDs |
| `/mastertmt` | dates | `tpucode`, product fields, `fsn`, numeric `status` | **TPU only**; `0` active, `1` cancelled | **no** | 34,487 unique; all returned status `0` |
| `/concept` | dates | `tmtid`, `fsn`, `change_date`, `level_name` | all eight TMT levels | yes | 112,986 unique |
| `/relationship` | dates | ordered `concept1,concept2`, their levels, `change_date` | manual does not define parent/child | yes | 156,522 unique edges |
| `/version` | empty body | root `success,tmt_version`; version string | dataset version | no | `20261102` |

Manual omissions that must not be guessed: page size/pagination, maximum window, ordering, boundary inclusivity, tombstones, whether a removed edge is re-emitted, uniqueness keys, retry limits, semantic labels for `concept1`/`concept2`, and whether older endpoint records remain available forever.

## Proof of TMT ID 764169

### Identity cross-check

- `/concept`: `tmtid=764169`, `level_name="gpu"`, `change_date=2020-07-02`, FSN `lidocaine hydrochloride 400 mg/20 mL solution for injection, 20 mL vial (GPU)`.
- `/gpu`: `gpuid=764169`, same date, FSN without the level suffix: `lidocaine hydrochloride 400 mg/20 mL solution for injection, 20 mL vial`.
- The apparent FSN mismatch is systematic formatting: `/concept` appends ` (LEVEL)` while level-specific endpoints do not. The clinical name is otherwise identical.

### Direct relationships

The live API returned 13 direct edges for `764169`:

- one inbound `gp -> gpu`: `1147579 -> 764169`;
- nine outbound `gpu -> tpu`: `565818`, `566021`, `736460`, `764182`, `838408`, `864230`, `1181555`, `565737`, `1350824`;
- three outbound `gpu -> gpp`: `1181564`, `1181586`, `1311037`.

Therefore GPU to TPU is a **direct one-hop edge** for this acceptance case. All nine TPU codes exist in `/tpu`, exist in `/mastertmt`, and had `status=0`; active TPU count is 9. No drug-name inference was used.

Examples include `565818` XYLOCAINE 2%, `764182` LIDOCAINE HYDROCHLORIDE (องค์การเภสัชกรรม), and `1350824` LIDOCAINE HCL 2% 20 ML INJ. The GPU itself is searchable but is not an eligible commercial TMT mapping target under the proposed rule; the user chooses one of the active related TPUs.

## Hierarchy and relationship findings

Observed ordered pair matrix across all 156,522 live edges:

| `level_name1 -> level_name2` | Edges | Direct pattern observed |
|---|---:|---|
| `subs -> vtm` | 6,135 | yes |
| `vtm -> gp` | 9,015 | yes |
| `gp -> gpu` | 10,948 | yes |
| `gp -> tp` | 32,025 | yes |
| `gpu -> tpu` | 34,487 | yes |
| `tp -> tpu` | 34,487 | yes |
| `gpu -> gpp` | 8,185 | yes |
| `gpp -> gpp` | 2,984 | pack nesting |
| `tpu -> tpp` | 12,792 | yes |
| `tpp -> tpp` | 5,464 | pack nesting |

The live direction consistently moves from a broader/upstream concept to a more specific/downstream concept or pack. It is safe to preserve and query that observed order. It is **not** safe to call it a contractual parent/child direction because the manual names only `concept1` and `concept2`. Store both sides exactly, expose directional traversal for the observed matrix, and retain a bidirectional neighbor query for investigation and future contract changes.

- All actual level names are lowercase: `subs`, `vtm`, `gp`, `gpu`, `gpp`, `tp`, `tpu`, `tpp`.
- 44,326 nodes have more than one incoming neighbor and 23,675 have more than one outgoing neighbor; multi-parent/fan-out behavior is normal.
- No duplicate relationship pair was observed.
- No directed cycle was found around `764169` or the first 50 sampled concepts to depth 8. This is sample evidence, not a global acyclicity guarantee; every traversal still needs a visited set and depth/result bounds.

## Endpoint-specific versus concept cross-check

The required sample covered 2 SUBS, 2 VTM, 3 GP, 5 GPU, 2 GPP, 3 TP, 5 TPU, and 2 TPP records.

- IDs matched `tmt_concept.tmtid` in every sample.
- `change_date` matched in every sample.
- `level_name` matched the endpoint name in lowercase.
- FSN differed in every sample only because `/concept` adds the uppercase suffix `(SUBS)`, `(VTM)`, ..., `(TPP)`.

Decision: keep both endpoint-specific tables and `tmt_concept`. `tmt_concept` is authoritative for concept existence, level, canonical graph label, and graph lookup. The level-specific table is authoritative for its endpoint's unsuffixed FSN and extra fields such as manufacturer. This duplication is intentional and must be checked by an invariant report.

## Volume and request-shape findings

The following are rows returned across non-overlapping yearly windows, not promises of future maximum size:

| Endpoint | Rows | Unique keys | Approx response bytes | Avg/max latency ms |
|---|---:|---:|---:|---:|
| subs | 2,552 | 2,552 | 186,480 | 45 / 77 |
| vtm | 3,142 | 3,142 | 291,481 | 43 / 68 |
| gp | 9,015 | 9,015 | 1,039,240 | 61 / 119 |
| gpu | 10,948 | 10,948 | 1,403,992 | 71 / 162 |
| gpp | 8,070 | 8,070 | 1,116,095 | 54 / 101 |
| tp | 32,025 | 32,025 | 8,814,526 | 187 / 644 |
| tpu | 34,487 | 34,487 | 10,758,858 | 225 / 643 |
| tpp | 12,792 | 12,747 | 3,728,968 | 110 / 252 |
| nlem | 47,071 | 34,471 TPU IDs | 9,853,451 | 448 / 1,739 |
| atc | 39,096 | 33,459 TPU IDs | 8,401,614 | 392 / 868 |
| regno | 14,714 | 13,591 TPU IDs | 3,161,904 | 97 / 268 |
| mastertmt | 34,487 | 34,487 | 15,861,478 | 250 / 786 |
| concept | 112,986 | 112,986 | 22,214,856 | 478 / 1,400 |
| relationship | 156,522 | 156,522 pairs | 16,409,107 | 462 / 1,147 |

`imagelist` is incomplete in this evidence run: windows `2020-12-30..2021-12-29`, `2021-12-30..2022-12-29`, and `2022-12-30..2023-12-29` returned HTTP 500. Image endpoints must not gate core readiness.

Duplicate IDs in temporal enrichment are real changes, not duplicate noise. Examples include NLEM `ED -> NED`, corrected registration formatting, and replaced ATC codes on later dates. TPP's 45 extra rows were exact duplicate payloads for 43 IDs and must be idempotent no-ops.

## Status and deletion semantics

- The manual defines only `mastertmt.status`: `0=active`, `1=cancelled`.
- The complete bounded live scan returned 34,487 MasterTMT rows, all status `0`. No status `1` example was available to prove cancelled-row delivery.
- `/concept`, `/relationship`, and level endpoints expose no lifecycle/deletion field.
- The live API supplied changes but no documented tombstone. Absence from a window or a later version cannot prove deletion.

Phase 2-6 policy is therefore non-destructive: upsert incoming records, retain prior rows/edges, record last-seen version/time, and never mark inactive or prune solely from absence. Only an explicit status/tombstone or a separately approved full-snapshot reconciliation may retire data.

## Data Model v2

This section describes the Phase 2 foundation implemented by `src/db/schema/tmt.ts`, `src/db/schema/ttmt.ts`, `0014_tmt_data_model_v2.sql`, and `0015_ttmt_data_model_v2.sql`. API identifiers are stored as `BIGINT UNSIGNED` and parsed/serialized as strings at application boundaries to avoid JavaScript precision assumptions. All timestamps are UTC; TMT `change_date` remains `DATE`.

### Common lifecycle rules

- Endpoint-specific concept tables hold the latest row per endpoint ID. Replay is idempotent; update only when the incoming `change_date` is equal/newer, and treat an equal-date/different-payload row as a data-quality conflict.
- `tmt_nlem`, `tmt_atc`, and `tmt_regno` retain dated values because the same TPU legitimately appears with later changed values.
- Every source table stores `source_version` and `synced_at` as application metadata, not as fields claimed to come from TMT.
- `normalized_fsn` and other normalized columns are application search metadata. Raw API fields remain unchanged.
- No endpoint-specific table has a foreign key to `tmt_concept` or `tmt_tpu`; endpoints may arrive in any order. Post-run invariant checks report missing counterparts.
- No table prunes from absence. `last_seen_version` supports later evidence-based reconciliation without changing current semantics.

### Level-specific concept tables

The following five generic-level tables have the same shape, differing only in their manual ID field:

| Table | Columns | Keys/indexes | Source and lifecycle |
|---|---|---|---|
| `tmt_subs` | `subsid BIGINT UNSIGNED NOT NULL`, `fsn TEXT NOT NULL`, `change_date DATE NOT NULL`, `normalized_fsn VARCHAR(255) NULL`, `source_version CHAR(8) NOT NULL`, `last_seen_version CHAR(8) NOT NULL`, `synced_at DATETIME(3) NOT NULL`, `created_at/updated_at DATETIME(3) NOT NULL` | PK `subsid`; index `(change_date, subsid)`; index `(normalized_fsn)` | `/subs`; upsert by `subsid`, never prune by absence |
| `tmt_vtm` | same metadata with `vtmid` | PK `vtmid`; date/search indexes | `/vtm`; same rule |
| `tmt_gp` | same metadata with `gpid` | PK `gpid`; date/search indexes | `/gp`; same rule |
| `tmt_gpu` | same metadata with `gpuid` | PK `gpuid`; date/search indexes | `/gpu`; same rule |
| `tmt_gpp` | same metadata with `gppid` | PK `gppid`; date/search indexes | `/gpp`; identical duplicate replay is no-op |

`tmt_tp`, `tmt_tpu`, and `tmt_tpp` add manufacturer search:

| Table | Columns | Keys/indexes | Source and lifecycle |
|---|---|---|---|
| `tmt_tp` | `tpid BIGINT UNSIGNED`, `fsn TEXT`, `manufacturer TEXT`, `change_date DATE`, `normalized_fsn VARCHAR(255)`, `normalized_manufacturer VARCHAR(255)`, common version/sync/timestamp metadata | PK `tpid`; indexes `(change_date,tpid)`, `normalized_fsn`, `normalized_manufacturer` | `/tp`; latest row per `tpid` |
| `tmt_tpu` | same with `tpuid` | PK `tpuid`; same indexes | `/tpu`; identity/endpoint FSN truth for TPU |
| `tmt_tpp` | same with `tppid` | PK `tppid`; same indexes | `/tpp`; collapse exact duplicate payloads; conflicting equal-date rows are warnings |

All API fields in these tables are `NOT NULL` because the manual and live evidence returned them as strings/numbers on every row. Application metadata columns are also `NOT NULL` except normalized text, which is nullable when normalization produces an empty value.

### `tmt_nlem`

| Column | Type/nullability | Source/rule |
|---|---|---|
| `tpuid` | `BIGINT UNSIGNED NOT NULL` | `/nlem.tpuid` |
| `fsn` | `TEXT NOT NULL` | `/nlem.fsn`, preserved as received |
| `nlem` | `VARCHAR(32) NOT NULL` | `/nlem.nlem`; raw value |
| `change_date` | `DATE NOT NULL` | `/nlem.change_date` |
| `source_version` | `CHAR(8) NOT NULL` | application metadata |
| `synced_at` | `DATETIME(3) NOT NULL` | application metadata |

Primary key: `(tpuid, change_date, nlem)`. Indexes: `(tpuid, change_date)`, `(nlem, tpuid)`. Current NLEM is the distinct value set at the greatest `change_date` for a TPU. A single `ED`, `ED*`, or `NED` value normalizes to `E`, `E*`, or `N`; no value or multiple conflicting latest values produce blank ISED plus a warning.

### `tmt_atc`

Columns: `tpuid BIGINT UNSIGNED NOT NULL`, `fsn TEXT NOT NULL`, `atc VARCHAR(32) NOT NULL`, `change_date DATE NOT NULL`, `source_version CHAR(8) NOT NULL`, `synced_at DATETIME(3) NOT NULL`.

Primary key: `(tpuid, change_date, atc)`. Indexes: `(tpuid, change_date)`, `(atc, tpuid)`. The current set is every distinct ATC value at the TPU's greatest `change_date`; multiple same-date ATCs are retained rather than collapsed.

### `tmt_regno`

Columns: `tpuid BIGINT UNSIGNED NOT NULL`, `fsn TEXT NOT NULL`, `regno VARCHAR(160) NOT NULL`, `normalized_regno VARCHAR(160) NOT NULL`, `change_date DATE NOT NULL`, `source_version CHAR(8) NOT NULL`, `synced_at DATETIME(3) NOT NULL`.

Primary key: `(tpuid, change_date, regno)`. Indexes: `(tpuid, change_date)`, `(normalized_regno, tpuid)`. Preserve raw spacing/year notation; normalization is search-only. If the latest date has more than one distinct registration, expose all and raise an ambiguity warning rather than selecting arbitrarily.

### `tmt_mastertmt`

| Column | Type/nullability | Source/rule |
|---|---|---|
| `tpucode` | `BIGINT UNSIGNED NOT NULL` | PK; `/mastertmt.tpucode`, explicitly TPU/TPUID |
| `activeingredient` | `TEXT NOT NULL` | manual field |
| `strength` | `TEXT NOT NULL` | manual field; no truncation |
| `dosageform` | `TEXT NOT NULL` | manual field |
| `contvalue` | `VARCHAR(80) NOT NULL` | empty string is valid source data |
| `contunit` | `VARCHAR(120) NOT NULL` | empty string is valid |
| `dispunit` | `VARCHAR(120) NOT NULL` | manual field |
| `tradename` | `TEXT NOT NULL` | manual field |
| `manufacturer` | `TEXT NOT NULL` | manual field |
| `fsn` | `TEXT NOT NULL` | manual field |
| `status` | `TINYINT UNSIGNED NOT NULL` | `0=active`, `1=cancelled`; unknown value is quarantined/warned |
| normalized search columns | `VARCHAR(255) NULL` | generic/trade/manufacturer/FSN application metadata |
| `source_version`, `last_seen_version` | `CHAR(8) NOT NULL` | application metadata |
| `synced_at`, `created_at`, `updated_at` | `DATETIME(3) NOT NULL` | application metadata |

Indexes: `(status,tpucode)`, normalized generic/trade/manufacturer indexes. `/mastertmt` does not expose `change_date`, so version + sync time are its only change provenance. Do not infer cancellation when a code is absent.

### `tmt_concept`

Columns: `tmtid BIGINT UNSIGNED NOT NULL` (PK), `fsn TEXT NOT NULL`, `change_date DATE NOT NULL`, `level_name VARCHAR(16) NOT NULL`, `normalized_fsn VARCHAR(255) NULL`, `source_version CHAR(8) NOT NULL`, `last_seen_version CHAR(8) NOT NULL`, `synced_at/created_at/updated_at DATETIME(3) NOT NULL`.

Indexes: `(level_name,tmtid)`, `(change_date,tmtid)`, `normalized_fsn`. Only the eight observed lowercase levels are accepted for eligibility; an unknown level is stored only through a quarantine/warning path until reviewed. This is concept existence/level/canonical graph-FSN truth.

### `tmt_relationship`

| Column | Type/nullability | Source/rule |
|---|---|---|
| `concept1` | `BIGINT UNSIGNED NOT NULL` | `/relationship.concept1` |
| `concept2` | `BIGINT UNSIGNED NOT NULL` | `/relationship.concept2` |
| `change_date` | `DATE NOT NULL` | source field |
| `level_name1` | `VARCHAR(16) NOT NULL` | source field |
| `level_name2` | `VARCHAR(16) NOT NULL` | source field |
| `source_version`, `last_seen_version` | `VARCHAR(32) NOT NULL` | application metadata |
| `synced_at`, `created_at`, `updated_at` | `DATETIME(3) NOT NULL` | application metadata |

Primary key: `(concept1, concept2)`. Indexes: `(concept2,concept1)`, `(level_name1,level_name2)`, `(change_date,concept1)`. Preserve API order. No concept foreign keys are added because relationship and concept windows can commit independently. Upsert equal/newer `change_date`; never delete an edge from absence.

### `tmt_version`

Columns: `id CHAR(36) NOT NULL` (PK), `tmt_version VARCHAR(32) NOT NULL`, `observed_at DATETIME(3) NOT NULL`, `http_latency_ms INT UNSIGNED NULL`, `core_sync_run_id CHAR(36) NULL`, `created_at DATETIME(3) NOT NULL`.

Unique `(tmt_version,observed_at)` plus indexes on version and observation time retain version observations without inventing effective-date semantics. Merely fetching `/version` does not mark the data set ready.

### Sync application metadata

Two additional internal tables are justified because endpoint-specific resume cannot be represented safely in the old one-cursor `standard_sync_runs` row:

- `tmt_sync_runs`: `id`, mode (`initial|incremental`), target version/date range, status, actor, received/written/warning counts, started/finished timestamps.
- `tmt_sync_checkpoints`: PK `(run_id, endpoint)`, window start/end, next window, status, attempts, received/written counts, last error code, updated time.

They are not TMT API payload tables. Phase 2 selected these names after MySQL/TiDB compatibility review and created them in migration 0014; that migration remains unapplied in production.

## TMT source-of-truth and invariants

| Concern | Source of truth | Required invariant |
|---|---|---|
| concept exists, level, canonical graph label | `tmt_concept` | endpoint ID must resolve to matching `level_name`; suffix difference is allowed |
| endpoint-specific identity/FSN | corresponding level table | ID and `change_date` should match concept; discrepancy is warning, not destructive repair |
| graph edge/order | `tmt_relationship` | levels should match both concepts; traversal has visited/depth/result limits |
| TPU detailed clinical/commercial fields and active/cancelled | `tmt_mastertmt` | `tpucode` should exist in concept and TPU endpoint; missing source does not block sync order |
| TPU endpoint identity/date/manufacturer | `tmt_tpu` | `tpuid = tmt_mastertmt.tpucode` when both exist |
| current NLEM/ISED | latest-date set in `tmt_nlem` | one recognized latest value for automatic ISED; conflicts warn/blank |
| current ATC | latest-date set in `tmt_atc` | preserve multiple same-date codes |
| registration | latest-date set in `tmt_regno` | preserve raw and normalized values; conflicts visible |
| dataset readiness | latest successful core sync run + `tmt_version` | version fetch alone is not readiness |

No cross-source FK should make ingestion fail because one endpoint arrived first. Invariant reports run after each core sync and are persisted with bounded example IDs/counts.

## TTMT separation design

The only verified TTMT contract is the approved MasterTTMT spreadsheet consumed by the current importer. Its aliases demonstrate fields for code, active ingredient, strength, dosage form, content, dispensing unit, trade name, manufacturer, FSN, status, NLEM/ISED, and registration. There is no evidence of TMT levels, relationship endpoints, or a TTMT API.

Implemented Phase 2 TTMT foundation:

- `ttmt_imports`: immutable import metadata (`id`, version, file hash/name, row count, status, imported_by, started/completed timestamps). Unique version and content hash prevent accidental replay.
- `ttmt_products`: current approved product keyed by `ttmtcode`, with the verified source fields, normalized search columns, `status`, `source_import_id`, and timestamps.

An append-only `ttmt_import_rows` table was not added because the owner-approved Phase 2 acceptance requires only import metadata and current products, and the current importer has no verified immutable-row contract. It can be proposed later only with an approved file/audit requirement.

Do not create `ttmt_gpu`, `ttmt_tpu`, or other TMT-shaped tables without a TTMT contract. `standard_products`, `standard_imports`, and TTMT rows currently mixed into them are reset during cutover after the new importer is verified.

## Mapping v2 design

### Chosen reference

Use one explicit tuple in `drug_mappings`:

- `standard_source VARCHAR(8) NOT NULL` - `TMT` or `TTMT`;
- `standard_code VARCHAR(64) NOT NULL` - source code as text at application boundaries;
- `standard_level VARCHAR(16) NOT NULL` - actual TMT level, or `masterttmt` for the verified TTMT file contract.

This is preferable to separate nullable `tmt_id`/`ttmt_code` columns because it supports future TP/GP-F/GP-X eligibility without another mapping-table rewrite and keeps audit/export payloads uniform. The trade-off is no polymorphic database FK. The save/reconcile transaction must validate the tuple against the source-specific table and current eligibility before writing. Audit stores all three values.

### Eligibility

- Every TMT concept is searchable and explainable.
- `drugtype=01`, PRODUCTCAT `1`: only `standard_source=TMT`, `standard_level=tpu`, matching `tmt_tpu` + `tmt_mastertmt`, and `status=0` is selectable.
- `drugtype=10`, PRODUCTCAT `3`: only active `standard_source=TTMT`, `standard_level=masterttmt` rows are selectable.
- PRODUCTCAT `2`/`4` remain unsupported until evidence-backed TP/GP-F/GP-X rules exist. TPU must continue to be rejected for them; commercial SPECPREP remains empty.
- GPU `764169` is displayed with its graph and related TPUs but cannot be saved directly as a commercial mapping.
- Inactive/unknown-status TPU remains searchable but cannot be selected.

Lifecycle `pending/needs_review/mapped`, review acknowledgement, and export checkpoint semantics remain conceptually unchanged. Their validity resolver changes from mixed `standard_products` to source-specific eligibility. Review acknowledgement must include source/code/level state if those values can change independently.

## Reset plan for Phase 7 (design only)

### KEEP

- `users`, password hashes, roles/status, admin account, and required `facilities`.
- `app_settings`, encryption keys, TMT credential, session/rate-limit secret configuration, and `rate_limit_buckets`.
- `audit_logs`; do not erase business/security history without a separate retention/legal decision.
- `agent_installations` and `agent_credentials`; stable machine identity and active authentication should survive the data-model cutover.
- `agent_request_nonces` until normal expiry, because clearing them could reopen the replay window for already signed requests.

### RESET or revoke at the maintenance boundary

- Revoke/delete `sessions` through an approved maintenance operation so every user reloads against the new model; user accounts remain intact.
- Invalidate unused `agent_enrollment_tokens` and pending Agent commands so stale pre-cutover actions cannot execute later.
- Delete `agent_sync_staging`, then source/JHCIS domain and old `agent_sync_sessions`; preserve Agent installation/credential identity.
- Delete export preview tokens, export checkpoints, review acknowledgements, mappings, Drug Catalog rows/imports, source drugs, old standard sync/import history, `standard_products`, and TTMT old domain.
- Rebuild new TMT tables from the API and new TTMT tables from the approved file rather than converting mixed rows.

### Dependency-safe reset order

1. Enter maintenance mode, revoke sessions, stop sync/import/export mutations, and record table counts/hashes.
2. Back up the database and verify restore access.
3. Clear `export_preview_tokens`.
4. Clear `mapping_export_checkpoints` and `mapping_review_acknowledgements`.
5. Clear `drug_mappings`.
6. Clear `drug_catalog_rows`, then `drug_catalog_imports`.
7. Clear `agent_sync_staging`; clear `source_drugs`; then clear old `agent_sync_sessions`.
8. Invalidate enrollment tokens and clear obsolete commands while retaining installations, credentials, and nonces.
9. Clear old `standard_products`, `standard_imports`, and `standard_sync_runs` after all mapping/export consumers are empty.
10. Clear/reseed only the new TMT/TTMT domain tables required by the approved cutover run.

The final Phase 7 script must default to dry-run, require an exact database-name confirmation and a dedicated execute flag, print counts, run in a transaction where TiDB permits, fail closed, and contain explicit table allowlists. Phase 1 does not create that script.

## Cutover plan

1. Preflight Git/deployment/migration identity and verify no concurrent work.
2. Capture backup, schema/journal hashes, per-table counts, and a restore drill checkpoint.
3. Announce and enforce a maintenance boundary; stop Agent sync commands and business mutations.
4. Apply already-reviewed additive v2 migrations if not previously deployed; do not edit old migrations.
5. Run the approved domain reset in dependency order while preserving the KEEP set.
6. Run TMT initial core sync and invariant report; require a successful `tmt_version`-bound run.
7. Import the approved MasterTTMT file/version and validate counts/hash.
8. Resume Agent/JHCIS sync to rebuild `source_drugs`.
9. Re-import the latest verified Drug Catalog per facility.
10. Perform new mapping/review workflow with explicit source/level eligibility.
11. Smoke full/delta export and the 22-column Excel contract.
12. Verify dashboard/admin/readiness/logs/counts before reopening traffic.

Rollback is restore-based: keep the prior application artifact and a verified database backup, stop traffic, restore the full pre-cutover database, redeploy the prior application, and verify login/Agent/mapping/export health. A partial reverse migration is not an acceptable rollback after destructive reset.

## Sync engine v2

### Endpoint groups

Core readiness requires:

- `/version`;
- `/concept` and `/relationship`;
- `/mastertmt`, `/nlem`, and `/regno`;
- `/subs`, `/vtm`, `/gp`, `/gpu`, `/gpp`, `/tp`, `/tpu`, and `/tpp`.

Optional/failure-isolated endpoints:

- `/atc` - useful for search but not required for current mapping/export;
- `/imagelist` and `/image` - media failure must never fail a core sync.

### Initial sync

- Capture `/version` first and bind the run to that value.
- Use non-overlapping windows of at most 365 days from `2013-01-01` to the run date. This is an application safety decision; the manual does not impose that maximum.
- Process endpoints sequentially or with a very small explicit concurrency cap (maximum 2) to avoid request bursts.
- Validate each response before writing. Upsert a bounded DB chunk (recommended 500 rows) and advance the endpoint/window checkpoint in the same transaction.
- Run all concept/relationship and level tables before publishing readiness. MasterTMT enrichment can run after TPU identities exist, but FK ordering is intentionally not required.
- Store no access token on disk or in the database; refresh once after 401/403 and then fail the window.
- Mark the run successful only after every core endpoint completes and invariant checks finish. Optional failures become warnings.

### Incremental sync

- Start from each endpoint's own last successful end date, not one global cursor.
- Re-read a 30-day overlap initially, matching the proven current behavior. This is a design decision, not a manual contract; make it configurable only if operational evidence requires it.
- Idempotently replay duplicate TPP rows and repeated enrichment events.
- Do not prune rows/edges absent from the overlap.
- If `/version` changes during a long initial run, finish or fail the bound run consistently, then schedule another incremental run; never silently relabel mixed data as the newer version.

### Retry and resume

- Retry timeout/429/5xx with bounded exponential backoff and jitter, maximum 3 attempts per window.
- Respect `Retry-After` if supplied. Do not retry 400/401/403 except one token refresh for 401/403.
- Resume at `(run, endpoint, next_window)` and replay the incomplete window; DB upserts must be idempotent.
- Isolate endpoint failures. A failed optional endpoint does not roll back successful core data or readiness from the previous successful run.
- Keep prior successful data visible while a new run is incomplete; UI readiness shows the latest successful version plus the in-progress run separately.

### Data-quality report

Each run records counts and bounded examples for:

- missing concept/level-specific counterparts;
- concept level mismatch;
- FSN difference beyond the expected ` (LEVEL)` suffix;
- unknown level/status/NLEM value;
- multiple conflicting latest NLEM/registration values;
- duplicate or self/cyclic relationship observations;
- MasterTMT TPU missing from `/tpu` or `tmt_concept`;
- endpoint response field/type drift;
- optional endpoint failures, including `/imagelist` historical HTTP 500 windows.

## Search and TMT Browser design

### Level markers

Phase 4 follows the owner-approved TMT Browser convention: GP red, GPU green, TP yellow, and TPU blue. Every decorative color marker includes a textual level badge such as `GPU`; color alone is not accessible or sufficient. SUBS/VTM/GPP/TPP use neutral application styling without claiming an official color meaning. `TMT_LEVEL_PRESENTATION` is the single presentation source.

### Search

- Exact/prefix TMT ID search starts in `tmt_concept` and returns every level.
- FSN search uses normalized concept/endpoint FSN without relying on FULLTEXT.
- Filters include level, active/inactive/unknown, generic/trade/manufacturer, registration, and ATC.
- Product fields join only where meaningful: MasterTMT for TPU details/status; endpoint manufacturer for TP/TPU/TPP; latest-date NLEM/regno/ATC sets.
- Every result displays code, level, FSN, known status, source version, and `mappingEligible` with a human-readable reason.

### Concept detail and graph

- Show ordered outbound/inbound relationships separately and label the direction as “API concept1 -> concept2”, not contractual parent/child.
- Traverse with a visited set, configurable maximum depth (default 2, hard maximum 4), and bounded result count (hard maximum 200).
- Provide known paths such as GPU -> TPU and TP -> TPU while preserving pack-to-pack relationships.
- Multi-parent nodes are displayed once with all direct incoming paths.

### Acceptance behavior for `764169`

```text
764169
Level: GPU
FSN: lidocaine hydrochloride 400 mg/20 mL solution for injection, 20 mL vial (GPU)
Direct relationships: 1 GP, 9 TPU, 3 GPP
Mapping eligible: No - commercial TMT mappings require an active TPU
Related TPU: 9 direct results; all status 0 in version 20261102
```

The GPU row has no save button. Each related TPU displays trade/manufacturer/status and opens read-only detail; inactive or unknown status remains visible with a reason.

### Phase 4 implementation state

- Authenticated read-only routes are `GET /api/v1/tmt-v2/search` and `GET /api/v1/tmt-v2/concepts/:id`; all inputs and graph bounds are validated before database access.
- The hidden internal page is `/admin/tmt-v2`. It is absent from normal navigation and does not call mapping persistence.
- `TMT_V2_BROWSER_ENABLED` is default-off. Disabled page/routes do not construct the database pool or query v2 tables.
- Exact numeric lookup ranks first; numeric prefixes use bounded `BIGINT` ranges, normalized FSN uses prefix search, and optional manufacturer/registration/ATC/NLEM filters remain parameterized.
- Direct edges preserve `concept1 -> concept2`. Bounded application-side BFS handles cycles, self edges, multi-parent and dangling concepts without choosing arbitrary conflict values.
- Mapping eligibility is preview-only and currently states only the approved commercial TPU rule.
- Activation requires migrations 0014/0015, a successful v2 sync, reviewed invariants, and an explicit enable flag. Production migration, enablement, and legacy cutover remain outside Phase 4.

## Test plan for Phases 2-6

### API parser tests

- One fixture and malformed/field-drift case for all 18 endpoints.
- Token root/type and redaction; raw bearer never logged.
- Numeric IDs converted safely to application strings at external boundaries.
- `/image` nested pack/image parser tested without committing base64 fixtures from live data.

### Schema tests

- Exact table/column names match this document and the manual.
- PK/unique/index definitions for every required table.
- TMT/TTMT equal code values coexist in separate namespaces.
- Temporal NLEM/ATC/regno rows retain later changes; exact replay is idempotent.
- Relationship reverse lookup index and no ingestion-order FK dependency.

### Sync tests

- Initial full windows, incremental 30-day overlap, endpoint-specific resume, duplicate replay, failed window, malformed response, token expiry/refresh, bounded retry, and version change mid-run.
- Core failure leaves prior readiness intact; image/imagelist/optional ATC failure does not fail core.
- Duplicate TPP payload is no-op; duplicate relationship pair does not multiply rows.
- Unknown status/level and conflicting latest enrichment produce warnings, not guessed data.
- Absence never deletes or deactivates a concept/edge/product.

### Hierarchy tests

- Exact code and level lookup, inbound/outbound edge query, multi-hop traversal, result/depth bounds, multi-parent display, duplicate edges, and cycle protection.
- Fixture for the verified `764169` graph: GPU level, one GP edge, nine TPU edges, three GPP edges, one-hop TPU path.
- Direction labels remain API-oriented and do not claim a manual-defined parent/child relationship.

### Mapping tests

- GPU `764169` cannot be saved as a commercial TPU mapping.
- Active TPU is eligible; inactive/unknown/missing MasterTMT TPU is rejected.
- PRODUCTCAT `2`/`4` still rejects TPU and requires its future evidence-backed concept rules.
- TTMT validation is independent and cannot resolve through TMT tables.
- Catalog auto-map validates source/level/status; manual mapping remains protected by lifecycle/review rules.

### Export tests

- Correct TMTID/source-specific field resolution, current ISED normalization, registration selection/conflict handling, and invalid mapping exclusion.
- Full/delta checkpoint behavior remains based on mapping version, not standard sync timestamps.
- Existing 22-column header/order, PRODUCTCAT, SPECPREP, UPDATEFLAG, dates, Thai text, leading zeroes, and Excel-open verification remain mandatory.

## Risks and unresolved questions

1. The manual does not define `concept1` as parent or `concept2` as child. Live direction is consistent but remains an observed convention.
2. Deletion/tombstone behavior is unknown. No absence-based prune is permitted.
3. Although the manual defines MasterTMT status `1`, the full live scan returned only status `0`; cancelled-delivery behavior is unproven.
4. `/mastertmt` accepts date windows but omits `change_date`, so version/time is the only exposed provenance.
5. `/imagelist` returned HTTP 500 for three historical windows; historical image completeness cannot be guaranteed.
6. TPP returned exact duplicate rows; date-window boundary and server duplication semantics are undocumented.
7. NLEM/ATC/registration are temporal and may have multiple latest-date values. Conflict policy requires owner/domain confirmation if this occurs in current data.
8. The TTMT source-file contract, authoritative headers, status meanings, and version policy need an approved sample/spec before Phase 2 finalizes TTMT DDL.
9. PRODUCTCAT `2`/`4` references TP/GP-F/GP-X, while the live `level_name` set contains `gp` and `tp` but no explicit `gp-f`/`gp-x`; eligibility must not be invented.
10. API rate limits and supported maximum historical window are undocumented. Operational concurrency must stay conservative.

## Alternatives considered

### Keep expanding `standard_products`

Rejected. It preserves the code collision, mixes TMT/TTMT semantics, loses graph/history, and makes every new endpoint another nullable column set.

### Store only `tmt_concept` plus relationship and MasterTMT

Rejected for the owner's naming requirement and because endpoint-specific FSN/manufacturer/change history is useful evidence. It would also make endpoint contract drift harder to detect.

### Chosen: endpoint tables + graph + source-specific product detail

This mirrors the external contract, keeps raw provenance understandable, supports graph/search, and lets mapping eligibility be explicit. Intentional duplication is controlled by post-sync invariants rather than hidden behind a generic abstraction.

## Phase 2 implementation result

Phase 2 implements only the persistence and parser foundation:

1. Migrations 0014/0015 and Drizzle schemas add the 15 required TMT tables, `tmt_sync_runs/checkpoints`, `ttmt_imports`, and `ttmt_products`.
2. Typed Zod parsers/client methods cover all 18 documented endpoints while retaining the existing server credential resolver and memory-only bearer token.
3. Schema/parser/contracts use synthetic fixtures only; controlled local MySQL verifies clean migration through 0015 and idempotent journal rerun.
4. No production cutover, reset, data migration, search switch, mapping switch, export switch, or deletion of `standard_products` occurs.
5. Current production paths stay operational until later sync/search/mapping phases pass controlled verification.

Phase 2 returns for review before any production migration or live backfill. The next permitted phase is Phase 3 sync engine work.

## Phase 3 implementation result

Phase 3 adds a dormant sync engine under `src/modules/tmt/` without changing `src/modules/standards/sync.ts` or any production route/cron/consumer:

1. Full, incremental, and resume flows are version-bound, sequential, checkpointed per endpoint/window, and use atomic data-write/checkpoint transactions.
2. Retry uses three total attempts for timeout/network/429/5xx with bounded exponential backoff/jitter and Retry-After; 401/403 clears the memory token once and retries once.
3. Level/concept/relationship rows never regress an older change date; same-date conflicts are warnings. Temporal NLEM/ATC/RegNo identities preserve multiple values and exact replay is a no-op. MasterTMT retains raw status 0/1 and updates last-seen metadata without inferring absence.
4. ATC and ImageList are optional; Image remains on-demand. Invariant reports return aggregate counts and bounded examples only.
5. Controlled live local backfill against version `20261102` covered `2013-01-01` through `2026-11-04` in 198,728 ms: 521,999 received, 521,928 unique, 517,862 written, 71 exact duplicates. Three ImageList historical windows returned HTTP 500 and were isolated; core succeeded.
6. Local counts after incremental replay: SUBS 2,552; VTM 3,142; GP 9,015; GPU 10,948; GPP 8,070; TP 32,025; TPU 34,487; TPP 12,747; NLEM 47,071; ATC 39,096; RegNo 14,714; MasterTMT 34,487; Concept 112,986; Relationship 156,522. Incremental received 1,625 and wrote 0.
7. `764169` is GPU with the expected clinical FSN, one inbound GP, nine outbound TPU, three outbound GPP; all nine TPU exist in TPU/MasterTMT/Concept and have MasterTMT status 0.
8. Invariants found zero missing concept/endpoint counterparts, zero level/FSN mismatch, zero MasterTMT/TPU counterpart gaps, zero unknown level/status, and zero duplicate relationship pairs. Observable source-quality findings were 106 dangling relationship concepts, 16 self relationships, 1,446 ATC same-date conflicts, and 803 RegNo same-date conflicts.

Migrations 0014/0015 remain unapplied in production. Legacy standards/search/mapping/export/catalog/TTMT paths remain active. Phase 4 is the next permitted phase after review; it has not started.

## Phase 5 implementation result

Phase 5 adds a dormant mapping identity path only. Migration `0016_mapping_v2_identity.sql` adds nullable `drug_mappings.standard_source` and `standard_level`; it never guesses or backfills legacy rows. Source-specific server validation requires an active `tpu` concept plus MasterTMT status `0` for PRODUCTCAT 1, and an active `ttmt_products` row from a succeeded import for PRODUCTCAT 3. GPU `764169` stays inspectable and exposes its related TPU list, but cannot be persisted directly. PRODUCTCAT 2/4 stays fail-closed.

The authenticated `POST /api/v1/mappings/v2` is guarded by the mapping flag, while the hidden `/mappings/v2` workspace requires both mapping and browser flags; local acceptance enables both explicitly. The legacy mapping route, catalog reconcile, dashboard and export continue to use legacy standards. Changing v2 source/code/level writes `drug_mappings.updatedAt`, so the existing review acknowledgement automatically becomes stale without a permanent boolean. Production migration, environment enablement, export/catalog cutover and data reset remain outside Phase 5.

Local acceptance used isolated MySQL through migration 0016 and synthetic verified-shape fixtures only. It verified GPU `764169` direct rejection, nine related TPU rows, active/inactive status handling, server-truth reload, repeat-confirm no-op, acknowledgement staleness, TTMT namespace separation, facility isolation, and responsive layouts at 1366/768/390. The ordinary `/mappings` worklist remains legacy-only until the approved cutover phase.
