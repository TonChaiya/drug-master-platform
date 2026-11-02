# Admin Workspace Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/admin` faster to scan and shorter without changing any verified Dashboard/Admin business truth.

**Architecture:** Keep authentication, queries, and condition derivation in the existing server page/modules. Move only the facility overview presentation into one Admin-specific client component for local filtering, and add local edit/collapsed state to the existing client panels.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Tailwind CSS 4, Vitest.

**Spec:** User-approved design in this task plus `docs/SPEC.md` section 6.

## Global Constraints

- Do not change Mapping lifecycle, Agent/account status logic, queries, schema, API contracts, Export, or Agent protocol.
- Add no dependency and do not refactor shared UI broadly.
- Mutations stay asynchronous and must not full-page reload.
- Preserve compact responsive behavior and keyboard accessibility.
- Produce one final checkpoint commit and do not push or deploy.

## Review Focus

- Facility filter must operate only on already-loaded rows and expose active state with `aria-pressed`.
- Mapping presentation must keep mapped, needs-review, and pending distinct.
- Installer and TMT API forms must be collapsed by default without changing save/test/delete payloads.
- Account search and status filter must combine with AND semantics and show per-status counts.
- Horizontal table scrolling and controls must remain usable at 390, 768, 1366, and 1920 pixels.

---

### Task 1: Facility overview presentation and local filters

**Files:**
- Create: `src/app/(dashboard)/admin/facility-overview-table.tsx`
- Modify: `src/app/(dashboard)/admin/page.tsx`

- [x] Move only table presentation into a client component receiving existing summary rows.
- [x] Add accessible local filters: all, danger, warning, success.
- [x] Compact mapping, facility reason, account, and Agent/JHCIS/credential presentation.
- [x] Preserve all existing condition/count inputs and horizontal scrolling.

### Task 2: Compact management and configuration panels

**Files:**
- Modify: `src/app/(dashboard)/admin/facility-admin-panel.tsx`
- Modify: `src/app/(dashboard)/admin/agent-installer-panel.tsx`
- Modify: `src/app/(dashboard)/admin/tmt-api-panel.tsx`

- [x] Reduce unselected facility panel height while reusing the existing conditional controls.
- [x] Make installer and TMT API status-first with explicit edit/cancel modes.
- [x] Keep existing network methods, payloads, success/error feedback, and secret handling.

### Task 3: Account filtering and page density

**Files:**
- Modify: `src/app/(dashboard)/admin/user-table.tsx`
- Modify: `src/app/(dashboard)/admin/page.tsx`

- [x] Replace the status select with accessible count-bearing local filter buttons.
- [x] Keep search/status AND behavior and clear/empty states.
- [x] Tighten Admin-only spacing and secondary text contrast without changing shared tokens.

### Task 4: Documentation, visual review, verification, and checkpoint

**Files:**
- Modify: `docs/PROJECT_STATUS.md`

- [x] Record Admin UX refinement completion briefly.
- [x] Run targeted Admin test(s), `pnpm typecheck`, `pnpm lint`, and `git diff --check`.
- [x] Review local `/admin` at 1366x768, 1920x1080, 768px, and 390px; compare production only as read-only reference.
- [x] Review the complete diff for business-logic/schema/dependency drift.
- [x] Commit once as `refactor: streamline admin workspace` and do not push.
