import assert from "node:assert/strict";
import { test } from "vitest";
import { writeXls, type CellValue } from "@/lib/excel/biff-writer";
import { TtmtImportError } from "@/modules/standards/ttmt-import";
import {
  analyzeMasterTtmtV2,
  importMasterTtmtV2,
  type TtmtV2ImportStore,
} from "@/modules/standards/ttmt-v2-import";

const headers = ["TTMTCODE", "ACTIVEINGREDIENT", "STRENGTH", "DOSAGEFORM", "TRADENAME", "MANUFACTURER", "FSN", "STATUS", "NLEM", "REGNO"];
function cells(values: Array<string | null>): CellValue[] {
  return values.map((value) => value === null ? { kind: "blank" } : { kind: "text", value });
}
function workbook(rows: Array<Array<string | null>>): Buffer {
  return writeXls({ sheetName: "Sheet1", rows: [cells(headers), ...rows.map(cells)] });
}

test("v2 analysis uses the proven MasterTTMT columns and preserves active/inactive semantics", () => {
  const data = workbook([
    ["565818", "ยา ก", "10 mg", "tablet", "TRADE A", "ผู้ผลิต", "ยา ก 10 mg", "0", "ED", "1A 1/66"],
    ["565819", "ยา ข", "20 mg", "capsule", "TRADE B", "ผู้ผลิต", "ยา ข 20 mg", "inactive", "NED", null],
  ]);
  const result = analyzeMasterTtmtV2({ filename: "masterttmt.xls", version: "2026-11", data });
  assert.equal(result.rowCount, 2);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.products.map((row) => ({ code: row.ttmtcode, status: row.status, nlem: row.nlem })), [
    { code: "565818", status: "active", nlem: "ED" },
    { code: "565819", status: "inactive", nlem: "NED" },
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
    filename: "masterttmt.xls", version: "v1", data: workbook([["565818", "ยา ก", null, null, null, null, null, "0"]]),
    importedBy: "00000000-0000-4000-8000-000000000001", dryRun: false,
  }, store);
  assert.equal(result.dryRun, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.products[0]?.ttmtcode, "565818");
  assert.equal("standardCode" in (calls[0]?.products[0] ?? {}), false);
});
