import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("current mapping worklist has pending defaults, current filters, pagination, and review confirmation", async () => {
  const workbench = await source("src/components/mappings/v2-mapping-workbench.tsx");
  assert.match(workbench, /useState<LifecycleFilter>\("pending"\)/);
  assert.match(workbench, /useState<DrugTypeFilter>\("all"\)/);
  for (const label of ["คงค้าง", "ต้องตรวจสอบ", "จับคู่แล้ว", "ทั้งหมด", "01 · TMT", "10 · TTMT", "ล้างตัวกรอง"]) {
    assert.match(workbench, new RegExp(label));
  }
  assert.match(workbench, /pageSize: "30"/);
  assert.match(workbench, /<Pagination/);
  assert.match(workbench, /บันทึกและยืนยันว่าตรวจสอบแล้ว/);
  assert.match(workbench, /row\.standardSource/);
  assert.match(workbench, /row\.standardCode/);
  assert.match(workbench, /row\.standardLevel/);
  assert.match(workbench, /row\.statusReason/);
});

test("current worklist stays source-aware and does not call legacy mapping/search paths", async () => {
  const [workbench, service, route] = await Promise.all([
    source("src/components/mappings/v2-mapping-workbench.tsx"),
    source("src/modules/mappings/v2-worklist.ts"),
    source("src/app/api/v1/mappings/v2/worklist/route.ts"),
  ]);
  const currentPath = `${workbench}\n${service}\n${route}`;
  assert.match(currentPath, /\/api\/v1\/mappings\/v2/);
  assert.match(currentPath, /standardSource/);
  assert.match(currentPath, /loadMappedStandardsV2/);
  assert.doesNotMatch(currentPath, /standardProducts|\/api\/v1\/mappings\/save|\/api\/v1\/mappings\/search/);
  assert.match(service, /const standards = await loadMappedStandardsV2\(identities, db, release\)/);
  assert.match(service, /tmt_dataset_concepts/);
  assert.match(service, /ttmt_dataset_products/);
  assert.doesNotMatch(service, /for \(const .*await db\.select/);
});

test("reconcile action is only rendered when the current catalog pipeline is available", async () => {
  const [page, workbench, service] = await Promise.all([
    source("src/app/(dashboard)/mappings/page.tsx"),
    source("src/components/mappings/v2-mapping-workbench.tsx"),
    source("src/modules/mappings/service.ts"),
  ]);
  assert.match(page, /tmtV2CatalogEnabled/);
  assert.match(page, /reconcileAvailable=\{tmtV2CatalogEnabled\(\)\}/);
  assert.match(workbench, /reconcileAvailable \? <Button/);
  assert.match(workbench, /\/api\/v1\/mappings\/reconcile/);
  assert.match(service, /if \(tmtV2CatalogEnabled\(\)\)/);
  assert.match(service, /return reconcileFromLatestCatalogV2\(facilityId, userId\)/);
});
