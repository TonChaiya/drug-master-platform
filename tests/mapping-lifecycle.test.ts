import assert from "node:assert/strict";
import { test } from "vitest";
import { classifyMappingLifecycle, decideCatalogReconcile } from "@/modules/mappings/lifecycle";

test("unchanged catalog code keeps a current mapping without a write", () => {
  const input = {
    active: true,
    mapping: { source: "drug_catalog", standardCode: "TMT-001" },
    inLatestCatalog: true,
    latestCatalogTmtid: "TMT-001",
    everInCatalog: true,
  } as const;

  assert.deepEqual(decideCatalogReconcile(input), { action: "noop" });
  assert.deepEqual(classifyMappingLifecycle(input), { status: "mapped", reason: null });
});

test("catalog-owned mapping follows a changed valid TMT code", () => {
  const decision = decideCatalogReconcile({
    active: true,
    mapping: { source: "drug_catalog", standardCode: "TMT-OLD" },
    inLatestCatalog: true,
    latestCatalogTmtid: "TMT-NEW",
    everInCatalog: true,
  });

  assert.deepEqual(decision, { action: "update", standardCode: "TMT-NEW" });
});

test("manual mapping is preserved and reviewed when the catalog TMT changes", () => {
  const input = {
    active: true,
    mapping: { source: "manual", standardCode: "TMT-MANUAL" },
    inLatestCatalog: true,
    latestCatalogTmtid: "TMT-CATALOG",
    everInCatalog: true,
  } as const;

  assert.deepEqual(decideCatalogReconcile(input), { action: "needs_review" });
  assert.deepEqual(classifyMappingLifecycle(input), {
    status: "needs_review",
    reason: "TMT/TTMT ใน Drug Catalog เปลี่ยน แต่รายการนี้ถูกแก้แบบ manual",
  });
});

test("active drug missing from the latest snapshot needs review", () => {
  const input = {
    active: true,
    mapping: { source: "drug_catalog", standardCode: "TMT-001" },
    inLatestCatalog: false,
    latestCatalogTmtid: null,
    everInCatalog: true,
  } as const;

  assert.deepEqual(decideCatalogReconcile(input), { action: "needs_review" });
  assert.deepEqual(
    classifyMappingLifecycle(input),
    { status: "needs_review", reason: "รหัสนี้หายจาก Drug Catalog ล่าสุด" },
  );
});

test("mapped drug with an empty latest catalog TMT needs review", () => {
  const input = {
    active: true,
    mapping: { source: "drug_catalog", standardCode: "TMT-001" },
    inLatestCatalog: true,
    latestCatalogTmtid: null,
    everInCatalog: true,
  } as const;

  assert.deepEqual(decideCatalogReconcile(input), { action: "needs_review" });
  assert.deepEqual(classifyMappingLifecycle(input), {
    status: "needs_review",
    reason: "Drug Catalog ล่าสุดไม่มีรหัส TMT/TTMT",
  });
});

test("inactive drug missing from the latest snapshot stays out of the worklist", () => {
  assert.deepEqual(
    classifyMappingLifecycle({
      active: false,
      mapping: { source: "drug_catalog", standardCode: "TMT-001" },
      inLatestCatalog: false,
      latestCatalogTmtid: null,
      everInCatalog: true,
    }),
    { status: "hidden", reason: null },
  );
});

test("active drug never present in catalog and without mapping is pending", () => {
  assert.deepEqual(
    classifyMappingLifecycle({
      active: true,
      mapping: null,
      inLatestCatalog: false,
      latestCatalogTmtid: null,
      everInCatalog: false,
    }),
    { status: "pending", reason: null },
  );
});

test("new latest catalog row can create a mapping for an active unmapped drug", () => {
  assert.deepEqual(
    decideCatalogReconcile({
      active: true,
      mapping: null,
      inLatestCatalog: true,
      latestCatalogTmtid: "TMT-NEW",
      everInCatalog: true,
    }),
    { action: "create", standardCode: "TMT-NEW" },
  );
});

test("matching review acknowledgement resolves a manual catalog conflict", () => {
  const mappingUpdatedAt = new Date("2026-10-30T01:00:00.000Z");

  assert.deepEqual(
    classifyMappingLifecycle({
      active: true,
      mapping: { source: "manual", standardCode: "TMT-MANUAL", updatedAt: mappingUpdatedAt },
      inLatestCatalog: true,
      latestCatalogTmtid: "TMT-CATALOG",
      everInCatalog: true,
      reviewAcknowledgement: {
        mappingUpdatedAt,
        catalogPresent: true,
        catalogTmtid: "TMT-CATALOG",
      },
    }),
    { status: "mapped", reason: null },
  );
});

test("mapping change makes a review acknowledgement stale", () => {
  assert.deepEqual(
    classifyMappingLifecycle({
      active: true,
      mapping: { source: "manual", standardCode: "TMT-MANUAL", updatedAt: new Date("2026-10-30T01:00:01.000Z") },
      inLatestCatalog: true,
      latestCatalogTmtid: "TMT-CATALOG",
      everInCatalog: true,
      reviewAcknowledgement: {
        mappingUpdatedAt: new Date("2026-10-30T01:00:00.000Z"),
        catalogPresent: true,
        catalogTmtid: "TMT-CATALOG",
      },
    }),
    { status: "needs_review", reason: "TMT/TTMT ใน Drug Catalog เปลี่ยน แต่รายการนี้ถูกแก้แบบ manual" },
  );
});

test("catalog TMT change makes a review acknowledgement stale", () => {
  const mappingUpdatedAt = new Date("2026-10-30T01:00:00.000Z");

  assert.equal(
    classifyMappingLifecycle({
      active: true,
      mapping: { source: "manual", standardCode: "TMT-MANUAL", updatedAt: mappingUpdatedAt },
      inLatestCatalog: true,
      latestCatalogTmtid: "TMT-NEW",
      everInCatalog: true,
      reviewAcknowledgement: {
        mappingUpdatedAt,
        catalogPresent: true,
        catalogTmtid: "TMT-OLD",
      },
    }).status,
    "needs_review",
  );
});

test("missing catalog row can be acknowledged for the current mapping", () => {
  const mappingUpdatedAt = new Date("2026-10-30T01:00:00.000Z");

  assert.deepEqual(
    classifyMappingLifecycle({
      active: true,
      mapping: { source: "manual", standardCode: "TMT-MANUAL", updatedAt: mappingUpdatedAt },
      inLatestCatalog: false,
      latestCatalogTmtid: null,
      everInCatalog: true,
      reviewAcknowledgement: {
        mappingUpdatedAt,
        catalogPresent: false,
        catalogTmtid: null,
      },
    }),
    { status: "mapped", reason: null },
  );
});

test("catalog row returning makes an absent-state acknowledgement stale", () => {
  const mappingUpdatedAt = new Date("2026-10-30T01:00:00.000Z");

  assert.equal(
    classifyMappingLifecycle({
      active: true,
      mapping: { source: "manual", standardCode: "TMT-MANUAL", updatedAt: mappingUpdatedAt },
      inLatestCatalog: true,
      latestCatalogTmtid: "TMT-CATALOG",
      everInCatalog: true,
      reviewAcknowledgement: {
        mappingUpdatedAt,
        catalogPresent: false,
        catalogTmtid: null,
      },
    }).status,
    "needs_review",
  );
});
