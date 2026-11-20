import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { MappedStandardSummary } from "@/components/mappings/v2-mapping-workbench";
import type { V2WorklistRow } from "@/modules/mappings/v2-worklist";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const row = (overrides: Partial<V2WorklistRow> = {}): V2WorklistRow => ({
  sourceDrugId: "source-1", drugcode: "J-001", drugname: "Local drug", drugnamethai: null,
  druggenericname: "Local generic", drugtype: "01", mappingId: "mapping-1", mappingSource: "manual",
  standardSource: "TMT", standardCode: "565818", standardLevel: "tpu", updateFlag: "E",
  status: "mapped", statusReason: null, standardName: "Paracetamol 500 mg tablet",
  standardActiveIngredient: "Paracetamol", standardStrength: "500 mg", standardDosageForm: "tablet",
  standardTradeName: "PARA", standardManufacturer: "Example Pharma", standardEligible: true,
  ...overrides,
});

test("current mapping row presents decision metadata and mapping source compactly", () => {
  const html = renderToStaticMarkup(createElement(MappedStandardSummary, { row: row() }));
  for (const value of ["565818", "Paracetamol", "500 mg", "tablet", "PARA", "Example Pharma", "ผู้ใช้จับคู่"]) {
    assert.match(html, new RegExp(value));
  }
});

test("current mapping row renders nullable standard metadata safely", () => {
  const html = renderToStaticMarkup(createElement(MappedStandardSummary, { row: row({
    standardName: null, standardActiveIngredient: null, standardStrength: null, standardDosageForm: null,
    standardTradeName: null, standardManufacturer: null, mappingSource: null,
  }) }));
  assert.match(html, /565818/);
  assert.doesNotMatch(html, /undefined|null|ที่มา:/);
});

test("unmapped row stays compact and does not invent standard metadata", () => {
  const html = renderToStaticMarkup(createElement(MappedStandardSummary, { row: row({ standardCode: null, standardSource: null, standardLevel: null }) }));
  assert.match(html, /ยังไม่จับคู่/);
  assert.doesNotMatch(html, /Paracetamol|Example Pharma|ที่มา:/);
});

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
  for (const field of ["standardActiveIngredient", "standardStrength", "standardDosageForm", "standardManufacturer", "mappingSource"]) {
    assert.match(workbench, new RegExp(`row\\.${field}`));
  }
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
  for (const projection of ["standardActiveIngredient: standard?.activeIngredient", "standardStrength: standard?.strength", "standardDosageForm: standard?.dosageForm"]) {
    assert.match(service, new RegExp(projection.replace(/[?.]/g, "\\$&")));
  }
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
