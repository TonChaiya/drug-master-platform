import assert from "node:assert/strict";
import { test } from "vitest";
import { writeXls, type CellValue } from "@/lib/excel/biff-writer";
import { DRUGCAT_HEADERS, SHEET_NAME } from "@/modules/catalog/headers";
import { parseDrugCatalog } from "@/modules/catalog/parser";

/**
 * Both DrugCat layouts have to parse: the approved template opens with a "#"
 * counter (22 columns) and the exports the PHP system read start straight at
 * HOSPDRUGCODE (21). Rejecting the 21-column shape blocked files that had
 * already been accepted by สกส.
 */

const PAYLOAD_HEADERS = DRUGCAT_HEADERS.slice(1);

function textRow(values: string[]): CellValue[] {
  return values.map((value) => ({ kind: "text", value }) as CellValue);
}

/** A sheet with one data row, in either layout. */
function build(rows: CellValue[][]): Buffer {
  return writeXls({ sheetName: SHEET_NAME, rows });
}

function sheet(withCounter: boolean, code: string, extra: Partial<Record<string, string>> = {}): Buffer {
  const headers = withCounter ? [...DRUGCAT_HEADERS] : [...PAYLOAD_HEADERS];
  const payload = PAYLOAD_HEADERS.map((header) => extra[header] ?? "");
  payload[0] = code; // HOSPDRUGCODE
  const row = withCounter ? ["1", ...payload] : payload;
  return build([textRow(headers), textRow(row)]);
}

test("parses the 22-column template that opens with #", () => {
  const parsed = parseDrugCatalog(sheet(true, "0140"));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].values.hospdrugcode, "0140", "leading zero must survive");
});

test("parses the 21-column sheet that starts at HOSPDRUGCODE", () => {
  const parsed = parseDrugCatalog(sheet(false, "P1"));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].values.hospdrugcode, "P1");
});

test("reads every payload field from the same column in both layouts", () => {
  const extra = { TMTID: "459215", GENERICNAME: "thiamazole", ISED: "E", UPDATEFLAG: "A" };
  const withCounter = parseDrugCatalog(sheet(true, "X1", extra)).rows[0].values;
  const without = parseDrugCatalog(sheet(false, "X1", extra)).rows[0].values;
  assert.deepEqual(withCounter, without, "the counter column must not shift the payload");
  assert.equal(withCounter.tmtid, "459215");
  assert.equal(withCounter.genericname, "thiamazole");
  assert.equal(withCounter.ised, "E");
});

test("names the offending column when the first header is neither shape", () => {
  const wrong = build([textRow(["SOMETHING", ...PAYLOAD_HEADERS.slice(1)]), textRow(["a"])]);
  assert.throws(
    () => parseDrugCatalog(wrong),
    (error: Error & { code?: string; details?: string[] }) => {
      assert.equal(error.code, "CATALOG_HEADER_MISMATCH");
      assert.match(error.details?.[0] ?? "", /HOSPDRUGCODE/);
      return true;
    },
  );
});

test("rejects a duplicate HOSPDRUGCODE instead of silently keeping one", () => {
  const headers = textRow([...PAYLOAD_HEADERS]);
  const row = (code: string) => textRow(PAYLOAD_HEADERS.map((_, index) => (index === 0 ? code : "")));
  assert.throws(
    () => parseDrugCatalog(build([headers, row("D1"), row("D1")])),
    (error: Error & { code?: string }) => error.code === "CATALOG_DUPLICATE_CODE",
  );
});

test("skips fully empty rows rather than counting them", () => {
  const headers = textRow([...PAYLOAD_HEADERS]);
  const blank = textRow(PAYLOAD_HEADERS.map(() => ""));
  const filled = textRow(PAYLOAD_HEADERS.map((_, index) => (index === 0 ? "K9" : "")));
  const parsed = parseDrugCatalog(build([headers, blank, filled]));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.skippedEmptyRows, 1);
});
