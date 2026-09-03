import assert from "node:assert/strict";
import { test } from "vitest";
import { readFirstSheet } from "@/lib/excel/workbook";
import { cellText } from "@/lib/excel/sheet";
import { DRUGCAT_HEADERS } from "@/modules/catalog/headers";
import { buildDrugCatWorkbook, exportFilename } from "@/modules/exports/writer";
import type { ExportRow } from "@/modules/exports/rows";

/**
 * The .xls handed to สกส. is written by this repo, not by a spreadsheet
 * library, and a mistake in it is silent: the file opens, it just says the
 * wrong thing. These round-trip it through the reader and check the parts that
 * corrupt quietly — codes turning into numbers, dates turning into serials.
 */

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    hospdrugcode: "0140",
    productcat: "1",
    tmtid: "459215",
    specprep: "",
    genericname: "thiamazole",
    tradename: "TIMAZOL",
    dfscode: "",
    dosageform: "tablet",
    strength: "5 mg",
    content: "1 tablet",
    unitprice: "2",
    distributor: "",
    manufacturer: "สหแพทย์เภสัช",
    ised: "E",
    ndc24: "105573000003721120381506",
    packsize: "",
    packprice: "",
    updateflag: "A",
    datechange: null,
    dateupdate: null,
    dateeffective: "2026-11-27",
    ...overrides,
  };
}

function read(rows: ExportRow[]) {
  return readFirstSheet(buildDrugCatWorkbook(rows));
}

test("writes the locked 22-column header, in order", () => {
  const sheet = read([row()]);
  const headers = DRUGCAT_HEADERS.map((_, index) => cellText(sheet, 0, index));
  assert.deepEqual(headers, [...DRUGCAT_HEADERS]);
  assert.equal(cellText(sheet, 0, DRUGCAT_HEADERS.length), "", "nothing may follow the last column");
});

test("keeps a leading zero on HOSPDRUGCODE", () => {
  const sheet = read([row({ hospdrugcode: "0140" })]);
  assert.equal(cellText(sheet, 1, 1), "0140");
});

test("keeps a 24-digit NDC24 intact rather than rounding it to a float", () => {
  const ndc = "105573000003721120381506";
  const sheet = read([row({ ndc24: ndc })]);
  assert.equal(cellText(sheet, 1, 15), ndc);
});

test("writes DATEEFFECTIVE as a real date cell, not as text", () => {
  // The reader turns a date-formatted serial back into ISO, so getting the ISO
  // date back is the proof: a text cell would come back as the raw string, and
  // a serial without a date format would come back as a bare number.
  const sheet = read([row({ dateeffective: "2026-11-27" })]);
  assert.equal(cellText(sheet, 1, 21), "2026-11-27");
});

test("passes a date that is not ISO through as text rather than dropping it", () => {
  const sheet = read([row({ dateeffective: "27/11/2026" })]);
  assert.equal(cellText(sheet, 1, 21), "27/11/2026");
});

test("leaves a column with no source empty instead of inventing a value", () => {
  const sheet = read([row({ specprep: "", dfscode: "", packsize: "" })]);
  for (const column of [4, 7, 16]) {
    assert.equal(cellText(sheet, 1, column), "", `column ${column} must stay blank`);
  }
});

test("numbers the # column per row and writes one row per input", () => {
  const sheet = read([row({ hospdrugcode: "A1" }), row({ hospdrugcode: "A2" }), row({ hospdrugcode: "A3" })]);
  assert.equal(cellText(sheet, 1, 0), "1");
  assert.equal(cellText(sheet, 3, 0), "3");
  assert.equal(cellText(sheet, 3, 1), "A3");
  assert.equal(cellText(sheet, 4, 1), "", "no phantom fourth row");
});

test("refuses to build an empty export rather than shipping a header-only file", () => {
  assert.throws(
    () => buildDrugCatWorkbook([]),
    (error: Error & { code?: string }) => error.code === "EXPORT_EMPTY",
  );
});

test("names the file after the facility and the date", () => {
  const name = exportFilename("05957", new Date("2026-09-03T01:00:00Z"));
  assert.match(name, /^05957_/);
  assert.match(name, /\.xls$/);
});
