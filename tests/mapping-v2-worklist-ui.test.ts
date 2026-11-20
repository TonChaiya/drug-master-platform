import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { MappedStandardSummary, MappingComparisonContext, canBrowseRelatedTpu, isCurrentCandidate, mappingStandardSearchUrl } from "@/components/mappings/v2-mapping-workbench";
import { EMPTY_STANDARD_FILTERS, type StandardFilterState } from "@/components/standard-search";
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

test("inline chooser compares the JHCIS drug with the current source-aware identity", () => {
  const html = renderToStaticMarkup(createElement(MappingComparisonContext, { row: row() }));
  for (const value of ["รายการยา JHCIS", "รหัสยา", "ชื่อยา", "J-001", "Local drug", "Local generic", "มาตรฐานที่จับคู่ปัจจุบัน", "แหล่งข้อมูล / ระดับ", "รหัสมาตรฐาน", "TMT", "TPU", "565818"]) assert.match(html, new RegExp(value));
  assert.match(html, /sm:grid-cols-2/);
  assert.equal((html.match(/bg-primary-50\/70/g) ?? []).length, 2);
  assert.equal((html.match(/overflow-hidden/g) ?? []).length, 2);
});

test("current candidate matching requires the complete source code and level identity", () => {
  assert.equal(isCurrentCandidate(row(), "TMT", "565818", "tpu"), true);
  assert.equal(isCurrentCandidate(row(), "TTMT", "565818", "product"), false);
  assert.equal(isCurrentCandidate(row(), "TMT", "565818", "gpu"), false);
  assert.equal(isCurrentCandidate(row(), "TMT", "other", "tpu"), false);
});

test("only GPU exposes the related-TPU action", () => {
  assert.equal(canBrowseRelatedTpu("gpu"), true);
  for (const level of ["gp", "tp", "tpu", "product"]) assert.equal(canBrowseRelatedTpu(level), false);
});

test("mapping chooser maps each independent filter to the source-specific query contract", () => {
  const cases: Array<[keyof StandardFilterState, string, string]> = [
    ["code", "q=Example", "code=Example"],
    ["tradeName", "tradeName=Example", "tradeName=Example"],
    ["genericName", "genericName=Example", "genericName=Example"],
    ["manufacturer", "manufacturer=Example", "manufacturer=Example"],
    ["registrationNumber", "registration=Example", "registrationNumber=Example"],
  ];
  for (const [key, tmtParam, ttmtParam] of cases) {
    const filters = { ...EMPTY_STANDARD_FILTERS, [key]: "Example" };
    assert.match(mappingStandardSearchUrl("TMT", filters), new RegExp(tmtParam));
    assert.match(mappingStandardSearchUrl("TTMT", filters), new RegExp(ttmtParam));
  }
  const combined = { code: "12", tradeName: "Trade", genericName: "Generic", manufacturer: "Maker", registrationNumber: "1A" };
  const url = mappingStandardSearchUrl("TMT", combined);
  for (const key of ["q=12", "tradeName=Trade", "genericName=Generic", "manufacturer=Maker", "registration=1A"]) assert.match(url, new RegExp(key));
});

test("mapping chooser keeps debounce, minimum length, stale response, and clear guards", async () => {
  const [workbench, standardSearch] = await Promise.all([
    source("src/components/mappings/v2-mapping-workbench.tsx"),
    source("src/components/standard-search.tsx"),
  ]);
  for (const label of ["รหัส TMT/TTMT", "ชื่อการค้า", "ชื่อสามัญ", "ผู้ผลิต", "เลขทะเบียนยา"]) assert.match(standardSearch, new RegExp(label));
  assert.match(workbench, /values\.some\(\(value\) => value\.length < 2\)/);
  assert.match(workbench, /setTimeout\(\(\) => void searchStandards\(\), 300\)/);
  assert.match(workbench, /requestId !== standardRequestIdRef\.current/);
  assert.match(workbench, /setStandardFilters\(EMPTY_STANDARD_FILTERS\)/);
  assert.doesNotMatch(workbench, /location\.reload|window\.location/);
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
  assert.match(workbench, /จับคู่อัตโนมัติยังไม่พร้อม — ยังจับคู่ด้วยตนเองได้/);
  assert.match(workbench, /\/api\/v1\/mappings\/reconcile/);
  assert.match(service, /if \(tmtV2CatalogEnabled\(\)\)/);
  assert.match(service, /return reconcileFromLatestCatalogV2\(facilityId, userId\)/);
});

test("chooser keeps structured results and explicit search and related-TPU states", async () => {
  const workbench = await source("src/components/mappings/v2-mapping-workbench.tsx");
  assert.match(workbench, /row\.standardCode \? "แก้ไข" : "จับคู่"/);
  assert.match(workbench, /บันทึกและยืนยันว่าตรวจสอบแล้ว/);
  assert.match(workbench, /standardSearchStatus === "loading"/);
  assert.match(workbench, /aria-label="กำลังโหลดผลค้นหา"/);
  assert.match(workbench, /standardSearchStatus === "empty"/);
  assert.match(workbench, /<EmptyState compact/);
  assert.match(workbench, /standardSearchStatus === "error"/);
  assert.match(workbench, /<ErrorState compact/);
  assert.match(workbench, /grid gap-2 px-1 sm:grid-cols-2/);
  assert.match(workbench, /aria-label="ตัวกรองค้นหามาตรฐาน"/);
  assert.match(workbench, /aria-label="ผลการค้นหามาตรฐาน"/);
  assert.match(workbench, /ผลการค้นหามาตรฐาน/);
  assert.match(workbench, /CandidateResultsPanel count=\{tmtRows\.length\}/);
  assert.match(workbench, /CandidateResultsPanel count=\{ttmtRows\.length\}/);
  assert.match(workbench, /ดู TPU ที่เกี่ยวข้อง/);
  assert.doesNotMatch(workbench, />รายละเอียด</);
  for (const state of ["detailStatus === \"loading\"", "detailStatus === \"empty\"", "detailStatus === \"error\"", "detailStatus === \"ready\""]) assert.match(workbench, new RegExp(state));
  assert.match(workbench, /TPU ที่เกี่ยวข้องกับ GPU/);
  assert.match(workbench, /m-2\.5 rounded-xl border border-primary-200 bg-surface p-3/);
  assert.match(workbench, /mx-auto w-full max-w-7xl/);
  assert.match(workbench, /border border-primary-200 bg-primary-50\/60 p-2/);
  assert.match(workbench, /divide-y divide-primary-100 overflow-hidden/);
  assert.match(workbench, /xl:grid-cols-\[minmax\(8rem,0\.75fr\)_minmax\(12rem,1\.15fr\)_minmax\(12rem,1\.15fr\)_minmax\(11rem,1fr\)_minmax\(9rem,0\.8fr\)_auto\]/);
  assert.match(workbench, /จับคู่รายการยา JHCIS กับมาตรฐาน/);
  assert.match(workbench, /IconStandards size=\{16\}/);
});
