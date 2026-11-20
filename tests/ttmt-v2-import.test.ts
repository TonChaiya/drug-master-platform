import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { writeXls, type CellValue } from "@/lib/excel/biff-writer";
import { TtmtImportError } from "@/modules/standards/ttmt-import";
import {
  analyzeMasterTtmtV2,
  importMasterTtmtV2,
  type TtmtV2ImportStore,
} from "@/modules/standards/ttmt-v2-import";

const headers = ["TTMTCode", "ActiveIngredient", "Strength", "Dosageform", "TradeName", "Manufacturer", "FSN", "Status", "TTMTType", "Changedate", "ED", "Drug_Group_Nhso", "REGNO"];
function cells(values: Array<string | null>): CellValue[] {
  return values.map((value) => value === null ? { kind: "blank" } : { kind: "text", value });
}
function workbook(rows: Array<Array<string | null>>): Buffer {
  return writeXls({ sheetName: "Sheet1", rows: [cells(headers), ...rows.map(cells)] });
}

test("v2 analysis uses the proven MasterTTMT columns and preserves active/inactive semantics", () => {
  const data = workbook([
    ["565818", "ยา ก", "10 mg", "tablet", "TRADE A", "ผู้ผลิต", "ยา ก 10 mg", "0", "RECIPE", "20261001", "ED", "H001", "1A 1/66"],
    ["565819", "ยา ข", "20 mg", "capsule", "TRADE B", "ผู้ผลิต", "ยา ข 20 mg", "inactive", "SINGLE", "20261002", "NED", "H002", null],
    ["565820", "ยา ค", null, null, null, null, null, "Active", "CANCEL", null, "ED", null, null],
  ]);
  const result = analyzeMasterTtmtV2({ filename: "masterttmt.xls", version: "2026-11", data });
  assert.equal(result.rowCount, 3);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.products.map((row) => ({
    code: row.ttmtcode, status: row.status, type: row.ttmtType,
    changeDate: row.changeDate, nlem: row.nlem, group: row.drugGroupNhso,
  })), [
    { code: "565818", status: "active", type: "RECIPE", changeDate: "20261001", nlem: "ED", group: "H001" },
    { code: "565819", status: "inactive", type: "SINGLE", changeDate: "20261002", nlem: "NED", group: "H002" },
    { code: "565820", status: "active", type: "CANCEL", changeDate: null, nlem: "ED", group: null },
  ]);
});

test("v2 parser rejects missing identity and duplicate code", () => {
  assert.throws(
    () => analyzeMasterTtmtV2({ filename: "bad.xls", version: "v1", data: writeXls({ sheetName: "Sheet1", rows: [cells(["NAME"]), cells(["x"])] }) }),
    (error: unknown) => error instanceof TtmtImportError && error.code === "TTMT_HEADER_MISSING",
  );
  assert.throws(
    () => analyzeMasterTtmtV2({ filename: "duplicate.xls", version: "v1", data: workbook([["565818"], ["565818"]]) }),
    (error: unknown) => error instanceof TtmtImportError && error.code === "TTMT_DUPLICATE_CODE",
  );
  assert.throws(
    () => analyzeMasterTtmtV2({ filename: "long-code.xls", version: "v1", data: workbook([["1".repeat(65)]]) }),
    (error: unknown) => error instanceof TtmtImportError && error.code === "TTMT_CODE_INVALID",
  );
});

test("dry-run parses and hashes without calling persistence", async () => {
  const calls: unknown[] = [];
  const store: TtmtV2ImportStore = { async commit(input) { calls.push(input); } };
  const result = await importMasterTtmtV2({
    filename: "masterttmt.xls", version: "v1", data: workbook([["565818", "ยา ก", null, null, null, null, null, "active"]]),
    importedBy: "00000000-0000-4000-8000-000000000001", dryRun: true,
  }, store);
  assert.equal(result.dryRun, true);
  assert.equal(result.rowCount, 1);
  assert.equal(calls.length, 0);
});

test("execute passes only v2 product records to one atomic store operation", async () => {
  const calls: Parameters<TtmtV2ImportStore["commit"]>[0][] = [];
  const store: TtmtV2ImportStore = { async commit(input) { calls.push(input); } };
  const result = await importMasterTtmtV2({
    filename: "masterttmt.xls", version: "v1", data: workbook([["565818", "ยา ก", null, null, null, null, null, "0", "CANCEL", "20261001", "ED", "H001"]]),
    importedBy: "00000000-0000-4000-8000-000000000001", dryRun: false,
  }, store);
  assert.equal(result.dryRun, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.products[0]?.ttmtcode, "565818");
  assert.equal(calls[0]?.products[0]?.ttmtType, "CANCEL");
  assert.equal(calls[0]?.products[0]?.status, "active");
  assert.equal("standardCode" in (calls[0]?.products[0] ?? {}), false);
});

test("v2 upsert replaces source fields with incoming values, including explicit nulls", async () => {
  const source = await readFile(new URL("../src/modules/standards/ttmt-v2-import.ts", import.meta.url), "utf8");
  for (const field of ["ttmtType", "changeDate", "drugGroupNhso"]) {
    assert.ok(source.includes(`${field}: sql` + "`values(${ttmtProducts." + field + "})`"));
  }
  assert.doesNotMatch(source, /delete\(|DELETE FROM ttmt_products|UPDATE ttmt_products SET status/i);
});
