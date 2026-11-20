import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("normal standards page is a TMT and TTMT hub without retired-system wording or sync controls", async () => {
  const page = await source("src/app/(dashboard)/standards/page.tsx");

  assert.match(page, /readTmtConsumerContext/);
  assert.match(page, /<TmtBrowser mode="advanced"/);
  assert.match(page, /TtmtSearch/);
  assert.match(page, /ttmtImports/);
  assert.doesNotMatch(page, /StandardsPanel|standardCounts|readSyncProgress/);
  assert.doesNotMatch(page, /legacy/i);
});

test("mapping entry and workflow navigation use one canonical user-facing route", async () => {
  const [mappingPage, compatibilityPage, layout] = await Promise.all([
    source("src/app/(dashboard)/mappings/page.tsx"),
    source("src/app/(dashboard)/mappings/v2/page.tsx"),
    source("src/app/(dashboard)/layout.tsx"),
  ]);

  assert.match(mappingPage, /tmtV2MappingEnabled/);
  assert.match(mappingPage, /V2MappingWorkbench/);
  assert.doesNotMatch(mappingPage, /redirect\("\/mappings\/v2"\)/);
  assert.match(compatibilityPage, /redirect\("\/mappings"\)/);
  assert.match(layout, /href: "\/mappings"/);
  assert.doesNotMatch(layout, /href: "\/mappings\/v2"/);

  const workflow = ["/jhcis", "/standards", "/drug-catalog", "/mappings", "/exports"];
  for (let index = 1; index < workflow.length; index += 1) {
    assert.ok(layout.indexOf(workflow[index - 1]!) < layout.indexOf(workflow[index]!), `${workflow[index - 1]} must precede ${workflow[index]}`);
  }
});

test("mapping readiness messages use user-facing TMT status language", async () => {
  const page = await source("src/app/(dashboard)/mappings/page.tsx");
  assert.match(page, /ข้อมูล TMT ล่าสุดต้องมีสถานะ/);
  assert.match(page, /ยังไม่ยืนยันเวอร์ชันจาก upstream/);
  assert.doesNotMatch(page, /latest TMT sync/);
  assert.doesNotMatch(page, /degraded/);
});

test("dashboard standards readiness no longer derives from legacy standard_products", async () => {
  const queries = await source("src/modules/facilities/queries.ts");
  assert.match(queries, /readTmtV2Readiness/);
  assert.match(queries, /ttmtImports/);
  assert.match(queries, /ttmtProducts/);
  assert.doesNotMatch(queries, /standardProducts/);
});

test("production workflow pages explain source-aware lifecycle and export modes", async () => {
  const [dashboard, catalog, exports, jhcis, admin] = await Promise.all([
    source("src/app/(dashboard)/dashboard/page.tsx"),
    source("src/app/(dashboard)/drug-catalog/page.tsx"),
    source("src/app/(dashboard)/exports/export-panel.tsx"),
    source("src/app/(dashboard)/jhcis/page.tsx"),
    source("src/app/(dashboard)/admin/page.tsx"),
  ]);

  assert.match(dashboard, /href="\/mappings"/);
  assert.doesNotMatch(dashboard, /href="\/mappings\/v2"/);
  assert.match(catalog, /source drug/i);
  assert.match(catalog, /TMT\/TTMT identity/i);
  assert.match(exports, /checkpoint/i);
  assert.match(exports, /TPU/);
  assert.match(jhcis, /ขั้นตอนแรก/);
  assert.match(admin, /validated_unverified/);
});

test("export choices name Full and Delta without changing checkpoint semantics", async () => {
  const exports = await source("src/app/(dashboard)/exports/export-panel.tsx");
  assert.match(exports, /label: "Full · ทั้งหมดที่จับคู่แล้ว"/);
  assert.match(exports, /label: "Delta · เฉพาะที่จับคู่ใหม่หรือแก้ไข"/);
  assert.match(exports, /checkpoint ของการส่งออกสำเร็จครั้งก่อน/);
});

test("TTMT search remains source-specific and exposes current product fields", async () => {
  const [route, search] = await Promise.all([
    source("src/app/api/v1/mappings/v2/standards/route.ts"),
    source("src/modules/standards/ttmt-search.ts"),
  ]);
  assert.match(route, /searchTtmtStandards/);
  assert.match(search, /p\.manufacturer/);
  assert.match(search, /p\.registration_number/);
  assert.match(search, /ttmt_dataset_products/);
  assert.doesNotMatch(`${route}\n${search}`, /tmtRelationship|tmtConcept|tmtMastertmt/);
});
