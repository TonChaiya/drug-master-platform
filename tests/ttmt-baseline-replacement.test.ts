import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { writeXls, type CellValue } from "@/lib/excel/biff-writer";
import {
  APPROVED_TTMT_REPLACEMENT,
  TtmtBaselineReplacementError,
  analyzeTtmtBaselineReplacement,
  runTtmtBaselineReplacement,
  ttmtBaselineReplacementStoreForPool,
  type TtmtBaselineReplacementStore,
  type TtmtReplacementContract,
  type TtmtReplacementPreflight,
} from "@/modules/standards/ttmt-baseline-replacement";
import { APPROVED_TTMT_V1 } from "@/modules/tmt/validation";

const APPROVED_MASTER_TTMT_HASH = "88618ebf566ed5680f7ad49c00e55ad920e6699c1324b707ea5375a440dca057";
const FORMER_MASTER_TTMT_HASH = "e78b3030c8bb63bfc78b96254edc43bc0d70ca81e2b5dc75d9040392440f489a";

const headers = ["TTMTCode", "ActiveIngredient", "Strength", "Dosageform", "Contvalue", "Contunit", "DispUnit", "TradeName", "Manufacturer", "FSN", "Status", "TTMTType", "Changedate", "ED", "Drug_Group_Nhso"];
const cells = (values: Array<string | null>): CellValue[] => values.map((value) => value === null ? { kind: "blank" } : { kind: "text", value });
function workbook(rows: Array<Array<string | null>>, sheetName = "l_ttmt_master_ed") {
  return writeXls({ sheetName, rows: [cells(headers), ...rows.map(cells)] });
}
const rows = [
  ["100", "ingredient", "5 mg", "tablet", null, null, null, "TRADE", "MAKER", "FSN", "0", "CANCEL", "20261001", "ED", null],
  ["200", "ingredient 2", null, null, null, null, null, null, null, null, "inactive", "SINGLE", null, null, null],
];
function contract(data: Buffer, overrides: Partial<TtmtReplacementContract> = {}): TtmtReplacementContract {
  return { version: "20261001", contentHash: createHash("sha256").update(data).digest("hex"), rowCount: 2, sheetName: "l_ttmt_master_ed", cancelCount: 1, columns: headers, ...overrides };
}
const safePreflight = (overrides: Partial<TtmtReplacementPreflight> = {}): TtmtReplacementPreflight => ({
  safe: true, currentProductCount: 2, succeededImportCount: 1, ttmtMappingCount: 1,
  currentImport: { id: "old", version: "20261001", contentHash: "old-hash", status: "succeeded" },
  validationReferenceCount: 1, datasetReferenceCount: 0, productForeignKeys: [], importForeignKeys: ["ttmt_products.fk:RESTRICT"], missingMappedCodes: [], ...overrides,
});
function store(preflight = safePreflight()): TtmtBaselineReplacementStore {
  return { preflight: vi.fn(async () => preflight), replace: vi.fn(async () => ({ importId: "new", archivedImportId: "old" })) };
}

describe("controlled TTMT baseline replacement", () => {
  test("uses the explicitly approved re-audited MasterTTMT evidence", () => {
    assert.equal(APPROVED_TTMT_REPLACEMENT.contentHash, APPROVED_MASTER_TTMT_HASH);
    assert.equal(APPROVED_TTMT_V1.contentHash, APPROVED_MASTER_TTMT_HASH);
    assert.notEqual(APPROVED_TTMT_REPLACEMENT.contentHash, FORMER_MASTER_TTMT_HASH);
  });

  test("enforces exact sheet, hash, columns, row count, unique codes and CANCEL count", () => {
    const data = workbook(rows);
    const analysis = analyzeTtmtBaselineReplacement({ filename: "MasterTTMT.xls", data }, contract(data));
    assert.equal(analysis.rowCount, 2);
    assert.equal(analysis.cancelCount, 1);
    assert.equal(analysis.products[0]?.ttmtType, "CANCEL");
    assert.equal(analysis.products[0]?.status, "active");
    assert.equal(analysis.products[1]?.strength, null);
    assert.throws(() => analyzeTtmtBaselineReplacement({ filename: "x.xls", data }, contract(data, { contentHash: "f".repeat(64) })),
      (error: unknown) => error instanceof TtmtBaselineReplacementError && error.code === "WORKBOOK_HASH_MISMATCH");
    assert.throws(() => analyzeTtmtBaselineReplacement({ filename: "x.xls", data }, contract(data, { rowCount: 3 })),
      (error: unknown) => error instanceof TtmtBaselineReplacementError && error.code === "WORKBOOK_ROW_COUNT_MISMATCH");
    assert.equal(analysis.products[0]?.status, "active");
    assert.equal(analysis.products[0]?.contvalue, null);
    expect(() => analyzeTtmtBaselineReplacement({ filename: "x.xls", data }, contract(data, { contentHash: "f".repeat(64) }))).toThrowError(TtmtBaselineReplacementError);
    const wrongSheet = workbook(rows, "Sheet1");
    expect(() => analyzeTtmtBaselineReplacement({ filename: "x.xls", data: wrongSheet }, contract(wrongSheet))).toThrowError(TtmtBaselineReplacementError);
    const duplicate = workbook([rows[0]!, rows[0]!]);
    expect(() => analyzeTtmtBaselineReplacement({ filename: "x.xls", data: duplicate }, contract(duplicate))).toThrowError();
  });

  test("dry-run performs reference preflight and never replaces products", async () => {
    const data = workbook(rows);
    const persistence = store();
    const result = await runTtmtBaselineReplacement({
      filename: "MasterTTMT.xls", data, execute: false, actorUserId: "", reason: "", expectedCurrentHash: "old-hash", contract: contract(data),
    }, persistence);
    assert.equal(result.mode, "dry-run");
    expect(persistence.preflight).toHaveBeenCalledOnce();
    expect(persistence.replace).not.toHaveBeenCalled();
  });

  test("execution is explicit and refuses missing mapped codes", async () => {
    const data = workbook(rows);
    const missing = store(safePreflight({ safe: false, missingMappedCodes: ["999"] }));
    await expect(runTtmtBaselineReplacement({
      filename: "x.xls", data, execute: true, confirmation: "REPLACE TTMT BASELINE 20261001",
      actorUserId: "00000000-0000-4000-8000-000000000001", reason: "approved", expectedCurrentHash: "old-hash", contract: contract(data),
    }, missing)).rejects.toMatchObject({ code: "REFERENCE_PREFLIGHT_FAILED", details: ["999"] });
    expect(missing.replace).not.toHaveBeenCalled();

    const persistence = store();
    await expect(runTtmtBaselineReplacement({
      filename: "x.xls", data, execute: true, actorUserId: "00000000-0000-4000-8000-000000000001",
      reason: "approved", expectedCurrentHash: "old-hash", contract: contract(data),
    }, persistence)).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(persistence.replace).not.toHaveBeenCalled();
  });

  test("successful replacement records a new event while preserving the archived import identity", async () => {
    const data = workbook(rows);
    const persistence = store();
    const result = await runTtmtBaselineReplacement({
      filename: "x.xls", data, execute: true, confirmation: "REPLACE TTMT BASELINE 20261001",
      actorUserId: "00000000-0000-4000-8000-000000000001", reason: "approved",
      expectedCurrentHash: "old-hash", contract: contract(data),
    }, persistence);
    assert.equal(result.mode, "executed");
    assert.equal(result.importId, "new");
    assert.equal(result.archivedImportId, "old");
    expect(persistence.replace).toHaveBeenCalledOnce();
  });

  test("implementation limits deletion to current TTMT products and keeps normal duplicate guards", async () => {
    const replacement = await readFile(new URL("../src/modules/standards/ttmt-baseline-replacement.ts", import.meta.url), "utf8");
    const importer = await readFile(new URL("../src/modules/standards/ttmt-v2-import.ts", import.meta.url), "utf8");
    const script = await readFile(new URL("../scripts/ttmt-baseline-replace.ts", import.meta.url), "utf8");
    assert.match(replacement, /DELETE FROM ttmt_products/);
    assert.doesNotMatch(replacement, /DELETE FROM (?!ttmt_products)|TRUNCATE|CASCADE/i);
    assert.match(replacement, /beginTransaction\(\)/);
    assert.match(replacement, /rollback\(\)/);
    assert.match(replacement, /standards\.ttmt_baseline_replaced/);
    assert.match(importer, /TTMT_VERSION_EXISTS/);
    assert.match(importer, /TTMT_FILE_EXISTS/);
    assert.doesNotMatch(importer, /baseline|replacement/i);
    assert.doesNotMatch(script, /\.env\.local|CREATE\s+DATABASE|process\.loadEnvFile/i);
  });

  test("database replacement rolls back the full transaction when a product insert fails", async () => {
    const data = workbook(rows);
    const analysis = analyzeTtmtBaselineReplacement({ filename: "x.xls", data }, contract(data));
    const connection = {
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(),
      query: vi.fn(async () => [[], []]),
      execute: vi.fn(async (sql: string) => {
        if (sql.startsWith("SELECT id,version")) return [[{ id: "00000000-0000-4000-8000-000000000009", version: "20261001", content_hash: "old-hash", status: "succeeded" }], []];
        if (sql.startsWith("SELECT id FROM ttmt_imports")) return [[], []];
        if (sql.startsWith("INSERT INTO ttmt_products")) throw new Error("synthetic insert failure");
        return [{ affectedRows: 1 }, []];
      }),
    };
    const pool = { getConnection: vi.fn(async () => connection) } as unknown as Pool;
    await expect(ttmtBaselineReplacementStoreForPool(pool).replace({
      analysis, expectedCurrentHash: "old-hash", actorUserId: "00000000-0000-4000-8000-000000000001", reasonSha256: "a".repeat(64),
    })).rejects.toThrow("synthetic insert failure");
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
