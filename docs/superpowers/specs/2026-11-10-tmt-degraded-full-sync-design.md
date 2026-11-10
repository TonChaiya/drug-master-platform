# TMT Degraded Full Sync Design

## Intent

Allow an explicitly requested, one-shot full TMT sync while `/version` is unavailable, without weakening the version-bound resume contract. This is preparation only: Phase 7I does not execute a production reset or sync and does not enable v2 consumers.

## Constraints

- Existing `full`/`incremental` runs remain version-bound and resume still requires a matching non-empty current version.
- A degraded run starts only when every TMT v2 source/run/checkpoint/version table is empty.
- It creates a new run and checkpoints; it never reuses a previous run.
- It never substitutes a previous or database-stored version.
- A stopped degraded run cannot be resumed.
- The 13 core endpoints and ATC are required for the one-shot degraded run. Imagelist is retried and checkpointed but remains optional because image metadata is not an input to hierarchy, mapping/export eligibility, or blocking invariants.
- Completion runs the normal blocking invariants plus the GPU `764169` acceptance check.
- Completion remains visibly unverified and is never `coreReady`; flags and maintenance require separate approval.

## Approaches

1. Add verification columns in a new migration. Clear, but unnecessary because existing string metadata can represent a separate run kind and terminal state.
2. Use existing metadata with `mode=full_unverified`, a run-scoped `unverified:<id>` source marker, and terminal `status=unverified`. **Selected:** smallest change, explicit in every persisted row, and the existing schema lengths support it.
3. Keep `mode=full` and change only the version value. Rejected because generic resume could mistake it for an ordinary versioned run.

## Behavior

`full-unverified` is a separate operational CLI mode protected by the existing environment, migration, maintenance, `--execute`, and exact database confirmation guards. Before creating a run it verifies all TMT v2 data and run metadata tables are empty. The engine generates a new run ID, derives a unique marker `unverified:<20 hex chars>`, writes all endpoint windows under that marker, runs invariants, and finishes with `status=unverified`, `error_code=TMT_VERSION_UNVERIFIED`, and `coreReady=false`.

Versioned resume rejects `full_unverified` runs before fetching a checkpoint. A process interruption leaves an unverified run that must be cleared by a separately approved reset before another degraded attempt.

## Schema

No migration. Existing limits are sufficient: `mode VARCHAR(16)`, `status VARCHAR(24)`, and version columns `VARCHAR(32)`.

## Non-goals

No parser weakening, production reset/sync, TTMT import, flag change, maintenance change, or production activation.
