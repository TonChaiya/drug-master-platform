import assert from "node:assert/strict";
import { test } from "vitest";
import { summarizeMappingLifecycleInputs, type MappingLifecycleSummaryInput } from "@/modules/mappings/summary";

const mappingUpdatedAt = new Date("2026-11-02T01:00:00.000Z");

function row(overrides: Partial<MappingLifecycleSummaryInput> = {}): MappingLifecycleSummaryInput {
  return {
    facilityId: "facility-a",
    drugtype: "01",
    lifecycle: {
      active: true,
      mapping: { source: "manual", standardCode: "TMT-1", updatedAt: mappingUpdatedAt },
      inLatestCatalog: true,
      latestCatalogTmtid: "TMT-1",
      everInCatalog: true,
      reviewAcknowledgement: null,
    },
    standardStatus: "active",
    standardType: "TMT",
    mappingUpdatedAt,
    ...overrides,
  };
}

function summarize(rows: MappingLifecycleSummaryInput[]) {
  const summary = summarizeMappingLifecycleInputs(rows).get("facility-a");
  assert.ok(summary);
  return summary;
}

test("counts active valid mapping as mapped and export-ready", () => {
  const summary = summarize([row()]);
  assert.deepEqual(
    { source: summary.sourceTotal, mapped: summary.mappedTotal, ready: summary.exportReadyTotal },
    { source: 1, mapped: 1, ready: 1 },
  );
});

test("counts active source without mapping as pending", () => {
  const summary = summarize([
    row({
      lifecycle: {
        active: true,
        mapping: null,
        inLatestCatalog: false,
        latestCatalogTmtid: null,
        everInCatalog: false,
      },
      standardStatus: null,
      standardType: null,
      mappingUpdatedAt: null,
    }),
  ]);
  assert.deepEqual({ pending: summary.pendingTotal, mapped: summary.mappedTotal }, { pending: 1, mapped: 0 });
});

test("counts manual catalog conflict as needs review", () => {
  const summary = summarize([
    row({ lifecycle: { ...row().lifecycle, latestCatalogTmtid: "TMT-2" } }),
  ]);
  assert.deepEqual({ review: summary.needsReviewTotal, mapped: summary.mappedTotal }, { review: 1, mapped: 0 });
});

test("counts current review acknowledgement as mapped", () => {
  const summary = summarize([
    row({
      lifecycle: {
        ...row().lifecycle,
        latestCatalogTmtid: "TMT-2",
        reviewAcknowledgement: {
          mappingUpdatedAt,
          catalogPresent: true,
          catalogTmtid: "TMT-2",
        },
      },
    }),
  ]);
  assert.equal(summary.mappedTotal, 1);
  assert.equal(summary.needsReviewTotal, 0);
});

test("counts stale review acknowledgement as needs review", () => {
  const summary = summarize([
    row({
      lifecycle: {
        ...row().lifecycle,
        latestCatalogTmtid: "TMT-2",
        reviewAcknowledgement: {
          mappingUpdatedAt: new Date("2026-11-01T01:00:00.000Z"),
          catalogPresent: true,
          catalogTmtid: "TMT-2",
        },
      },
    }),
  ]);
  assert.equal(summary.needsReviewTotal, 1);
  assert.equal(summary.mappedTotal, 0);
});

test("excludes inactive source drugs from every lifecycle count", () => {
  const summary = summarize([row({ lifecycle: { ...row().lifecycle, active: false } })]);
  assert.deepEqual(
    {
      source: summary.sourceTotal,
      mapped: summary.mappedTotal,
      pending: summary.pendingTotal,
      review: summary.needsReviewTotal,
    },
    { source: 0, mapped: 0, pending: 0, review: 0 },
  );
});

test("keeps lifecycle mapped but excludes invalid or inactive standards from export-ready", () => {
  const summary = summarize([
    row({ standardStatus: "inactive" }),
    row({ drugtype: "10", standardType: "TMT" }),
    row({ standardStatus: null, standardType: null }),
  ]);
  assert.equal(summary.mappedTotal, 3);
  assert.equal(summary.exportReadyTotal, 0);
});

test("v2 eligibility is the export-ready truth without consulting legacy standard status", () => {
  const ready = summarize([row({ standardStatus: null, standardType: null, standardEligible: true })]);
  assert.equal(ready.mappedTotal, 1);
  assert.equal(ready.exportReadyTotal, 1);

  const invalid = summarize([row({
    lifecycle: { ...row().lifecycle, standardValid: false },
    standardStatus: null,
    standardType: null,
    standardEligible: false,
  })]);
  assert.equal(invalid.mappedTotal, 0);
  assert.equal(invalid.needsReviewTotal, 1);
  assert.equal(invalid.exportReadyTotal, 0);
});
