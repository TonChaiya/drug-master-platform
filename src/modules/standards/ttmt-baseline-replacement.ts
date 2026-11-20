import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { readFirstSheet } from "@/lib/excel/workbook";
import { analyzeMasterTtmtV2 } from "./ttmt-v2-import";
import type { ParsedTtmtProduct } from "./ttmt-parser";

export const APPROVED_TTMT_REPLACEMENT = {
  version: "20261001",
  contentHash: "e78b3030c8bb63bfc78b96254edc43bc0d70ca81e2b5dc75d9040392440f489a",
  rowCount: 9_654,
  sheetName: "l_ttmt_master_ed",
  cancelCount: 17,
  columns: [
    "TTMTCode", "ActiveIngredient", "Strength", "Dosageform", "Contvalue", "Contunit", "DispUnit",
    "TradeName", "Manufacturer", "FSN", "Status", "TTMTType", "Changedate", "ED", "Drug_Group_Nhso",
  ],
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSERT_COLUMNS = [
  "ttmtcode", "activeingredient", "strength", "dosageform", "contvalue", "contunit", "dispunit", "tradename",
  "manufacturer", "fsn", "status", "ttmt_type", "change_date", "drug_group_nhso", "nlem", "registration_number",
  "source_version", "source_import_id", "normalized_generic", "normalized_trade", "normalized_manufacturer", "normalized_regno",
] as const;

export interface TtmtReplacementContract {
  version: string;
  contentHash: string;
  rowCount: number;
  sheetName: string;
  cancelCount: number;
  columns: readonly string[];
}
export interface TtmtReplacementAnalysis {
  filename: string;
  version: string;
  contentHash: string;
  rowCount: number;
  cancelCount: number;
  products: ParsedTtmtProduct[];
}

export interface TtmtReplacementPreflight {
  safe: boolean;
  currentProductCount: number;
  succeededImportCount: number;
  ttmtMappingCount: number;
  currentImport: { id: string; version: string; contentHash: string; status: string } | null;
  validationReferenceCount: number;
  datasetReferenceCount: number;
  productForeignKeys: readonly string[];
  importForeignKeys: readonly string[];
  missingMappedCodes: readonly string[];
}

export interface TtmtBaselineReplacementStore {
  preflight(analysis: TtmtReplacementAnalysis, expectedCurrentHash: string): Promise<TtmtReplacementPreflight>;
  replace(input: {
    analysis: TtmtReplacementAnalysis;
    expectedCurrentHash: string;
    actorUserId: string;
    reasonSha256: string;
  }): Promise<{ importId: string; archivedImportId: string }>;
}

export class TtmtBaselineReplacementError extends Error {
  constructor(readonly code: string, message: string, readonly details?: readonly string[]) {
    super(message);
    this.name = "TtmtBaselineReplacementError";
  }
}

function refuse(code: string, message: string, details?: readonly string[]): never {
  throw new TtmtBaselineReplacementError(code, message, details);
}

function normalizedHeader(value: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s_.-]/g, "");
}

export function analyzeTtmtBaselineReplacement(
  input: { filename: string; data: Buffer },
  contract: TtmtReplacementContract = APPROVED_TTMT_REPLACEMENT,
): TtmtReplacementAnalysis {
  const contentHash = createHash("sha256").update(input.data).digest("hex");
  if (contentHash !== contract.contentHash) refuse("WORKBOOK_HASH_MISMATCH", "Workbook SHA-256 does not match the approved replacement");
  const sheet = readFirstSheet(input.data);
  if (sheet.sheetName !== contract.sheetName) refuse("WORKBOOK_SHEET_MISMATCH", "Workbook worksheet does not match the approved replacement");
  const actualHeaders = (sheet.rows[0] ?? []).map(normalizedHeader).filter(Boolean);
  const expectedHeaders = contract.columns.map(normalizedHeader);
  if (actualHeaders.length !== expectedHeaders.length || expectedHeaders.some((header) => !actualHeaders.includes(header))) {
    refuse("WORKBOOK_COLUMNS_MISMATCH", "Workbook must contain the exact approved 15-column source contract");
  }
  const analysis = analyzeMasterTtmtV2({ filename: basename(input.filename), version: contract.version, data: input.data });
  if (analysis.rowCount !== contract.rowCount) refuse("WORKBOOK_ROW_COUNT_MISMATCH", "Workbook row count does not match the approved replacement");
  if (new Set(analysis.products.map((product) => product.ttmtcode)).size !== contract.rowCount) refuse("WORKBOOK_CODE_COUNT_MISMATCH", "TTMTCode values are not unique");
  const cancelCount = analysis.products.filter((product) => product.ttmtType === "CANCEL").length;
  if (cancelCount !== contract.cancelCount) refuse("WORKBOOK_CANCEL_COUNT_MISMATCH", "CANCEL source count does not match the approved replacement");
  return { filename: basename(input.filename), version: contract.version, contentHash, rowCount: analysis.rowCount, cancelCount, products: analysis.products };
}

export async function runTtmtBaselineReplacement(input: {
  filename: string;
  data: Buffer;
  execute: boolean;
  confirmation?: string;
  actorUserId: string;
  reason: string;
  expectedCurrentHash: string;
  contract?: TtmtReplacementContract;
}, store: TtmtBaselineReplacementStore) {
  const analysis = analyzeTtmtBaselineReplacement({ filename: input.filename, data: input.data }, input.contract);
  const preflight = await store.preflight(analysis, input.expectedCurrentHash);
  if (!preflight.safe) refuse("REFERENCE_PREFLIGHT_FAILED", "TTMT baseline replacement reference preflight failed", preflight.missingMappedCodes);
  if (!input.execute) return { mode: "dry-run" as const, analysis, preflight };
  if (!UUID.test(input.actorUserId)) refuse("ACTOR_REQUIRED", "A valid actor UUID is required");
  if (!input.reason.trim()) refuse("REASON_REQUIRED", "A reason is required");
  if (input.confirmation !== `REPLACE TTMT BASELINE ${analysis.version}`) refuse("CONFIRMATION_REQUIRED", "Exact baseline replacement confirmation is required");
  const replacement = await store.replace({
    analysis, expectedCurrentHash: input.expectedCurrentHash, actorUserId: input.actorUserId,
    reasonSha256: createHash("sha256").update(input.reason).digest("hex"),
  });
  return { mode: "executed" as const, analysis, preflight, ...replacement };
}

function numberValue(row: RowDataPacket | undefined, key: string): number {
  return Number(row?.[key] ?? 0);
}

async function tableExists(connection: Pick<Pool, "query"> | PoolConnection, table: string): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT 1 AS present FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1", [table],
  );
  return rows.length === 1;
}

export function ttmtBaselineReplacementStoreForPool(pool: Pool): TtmtBaselineReplacementStore {
  const preflight = async (analysis: TtmtReplacementAnalysis, expectedCurrentHash: string): Promise<TtmtReplacementPreflight> => {
    const [productRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM ttmt_products");
    const [importRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM ttmt_imports WHERE status='succeeded'");
    const [currentRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id,version,content_hash,status FROM ttmt_imports WHERE version=? LIMIT 2", [analysis.version],
    );
    const [mappingRows] = await pool.query<RowDataPacket[]>(
      "SELECT DISTINCT standard_code FROM drug_mappings WHERE standard_source='TTMT' AND standard_level='product'",
    );
    const [foreignKeys] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME,DELETE_RULE
       FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IN ('ttmt_products','ttmt_imports')`,
    );
    const productCodes = new Set(analysis.products.map((product) => product.ttmtcode));
    const mappedCodes = mappingRows.map((row) => String(row.standard_code));
    const current = currentRows[0];
    const validationReferenceCount = await tableExists(pool, "tmt_run_validations") && current
      ? numberValue((await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM tmt_run_validations WHERE ttmt_import_id=?", [current.id]))[0][0], "total") : 0;
    const datasetReferenceCount = await tableExists(pool, "standard_datasets") && current
      ? numberValue((await pool.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM standard_datasets WHERE ttmt_import_id=?", [current.id]))[0][0], "total") : 0;
    const productForeignKeys = foreignKeys.filter((row) => String(row.REFERENCED_TABLE_NAME) === "ttmt_products")
      .map((row) => `${String(row.TABLE_NAME)}.${String(row.CONSTRAINT_NAME)}:${String(row.DELETE_RULE)}`);
    const importForeignKeys = foreignKeys.filter((row) => String(row.REFERENCED_TABLE_NAME) === "ttmt_imports")
      .map((row) => `${String(row.TABLE_NAME)}.${String(row.CONSTRAINT_NAME)}:${String(row.DELETE_RULE)}`);
    const missingMappedCodes = [...new Set(mappedCodes.filter((code) => !productCodes.has(code)))].sort();
    const currentImport = current ? {
      id: String(current.id), version: String(current.version), contentHash: String(current.content_hash), status: String(current.status),
    } : null;
    return {
      safe: currentRows.length === 1 && currentImport?.status === "succeeded" && currentImport.contentHash === expectedCurrentHash
        && productForeignKeys.length === 0 && missingMappedCodes.length === 0,
      currentProductCount: numberValue(productRows[0], "total"), succeededImportCount: numberValue(importRows[0], "total"),
      ttmtMappingCount: mappedCodes.length, currentImport, validationReferenceCount, datasetReferenceCount,
      productForeignKeys, importForeignKeys, missingMappedCodes,
    };
  };

  return {
    preflight,
    async replace(input) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [currentRows] = await connection.execute<RowDataPacket[]>(
          "SELECT id,version,content_hash,status FROM ttmt_imports WHERE version=? FOR UPDATE", [input.analysis.version],
        );
        const current = currentRows[0];
        if (currentRows.length !== 1 || String(current?.content_hash) !== input.expectedCurrentHash || String(current?.status) !== "succeeded") {
          refuse("CURRENT_IMPORT_CHANGED", "Current approved TTMT import changed after preflight");
        }
        const [duplicateHash] = await connection.execute<RowDataPacket[]>("SELECT id FROM ttmt_imports WHERE content_hash=? LIMIT 1 FOR UPDATE", [input.analysis.contentHash]);
        if (duplicateHash.length !== 0) refuse("REPLACEMENT_HASH_EXISTS", "Replacement workbook hash already exists");
        const [mappedRows] = await connection.query<RowDataPacket[]>(
          "SELECT standard_code FROM drug_mappings WHERE standard_source='TTMT' AND standard_level='product' FOR UPDATE",
        );
        const replacementCodes = new Set(input.analysis.products.map((product) => product.ttmtcode));
        const missingMappedCodes = [...new Set(mappedRows.map((row) => String(row.standard_code)).filter((code) => !replacementCodes.has(code)))].sort();
        if (missingMappedCodes.length !== 0) refuse("MAPPED_CODE_MISSING", "Mapped TTMT codes are absent from the replacement workbook", missingMappedCodes);
        const [productReferences] = await connection.query<RowDataPacket[]>(
          `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
           WHERE CONSTRAINT_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='ttmt_products'`,
        );
        if (productReferences.length !== 0) refuse("PRODUCT_REFERENCE_CHANGED", "A foreign key now references ttmt_products");
        const archivedImportId = String(current.id);
        const archivedVersion = `${input.analysis.version}#replaced#${archivedImportId}`;
        if (archivedVersion.length > 120) refuse("ARCHIVE_VERSION_INVALID", "Archived import identity exceeds schema limit");
        await connection.execute("UPDATE ttmt_imports SET version=? WHERE id=? AND version=?", [archivedVersion, archivedImportId, input.analysis.version]);
        await connection.query("DELETE FROM ttmt_products");
        const importId = randomUUID();
        const now = new Date();
        await connection.execute(
          `INSERT INTO ttmt_imports (id,version,filename,content_hash,row_count,status,imported_by,started_at,completed_at)
           VALUES (?,?,?,?,?,'succeeded',?,?,?)`,
          [importId, input.analysis.version, input.analysis.filename, input.analysis.contentHash, input.analysis.rowCount, input.actorUserId, now, now],
        );
        for (let start = 0; start < input.analysis.products.length; start += 250) {
          const chunk = input.analysis.products.slice(start, start + 250);
          const placeholders = chunk.map(() => `(${INSERT_COLUMNS.map(() => "?").join(",")})`).join(",");
          const values = chunk.flatMap((product) => [
            product.ttmtcode, product.activeingredient, product.strength, product.dosageform, product.contvalue, product.contunit,
            product.dispunit, product.tradename, product.manufacturer, product.fsn, product.status, product.ttmtType,
            product.changeDate, product.drugGroupNhso, product.nlem, product.registrationNumber, input.analysis.version, importId,
            product.normalizedGeneric, product.normalizedTrade, product.normalizedManufacturer, product.normalizedRegno,
          ]);
          await connection.execute(`INSERT INTO ttmt_products (${INSERT_COLUMNS.join(",")}) VALUES ${placeholders}`, values);
        }
        const [verification] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) AS total,SUM(source_import_id=?) AS owned,SUM(ttmt_type='CANCEL') AS cancelled FROM ttmt_products", [importId],
        );
        if (numberValue(verification[0], "total") !== input.analysis.rowCount
          || numberValue(verification[0], "owned") !== input.analysis.rowCount
          || numberValue(verification[0], "cancelled") !== input.analysis.cancelCount) {
          refuse("POST_REPLACEMENT_INVALID", "TTMT replacement verification failed");
        }
        await connection.execute(
          `INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at)
           VALUES (?,?,'standards.ttmt_baseline_replaced','ttmt_import',?,?,?,?)`,
          [randomUUID(), input.actorUserId, importId,
            JSON.stringify({ importId: archivedImportId, version: input.analysis.version, contentHash: input.expectedCurrentHash }),
            JSON.stringify({ importId, version: input.analysis.version, contentHash: input.analysis.contentHash, rowCount: input.analysis.rowCount, reasonSha256: input.reasonSha256 }), now],
        );
        await connection.commit();
        return { importId, archivedImportId };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
    },
  };
}
