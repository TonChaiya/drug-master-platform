/**
 * PRODUCTCAT and SPECPREP rules.
 *
 * Scope is deliberately narrow: the standard catalogue holds commercial TPU
 * products only, so a local drugtype may map to categories 1 and 3 and nothing
 * else. Categories 2 and 4 (hospital-prepared) need TP / GP-F / GP-X concepts
 * that this system does not model yet — mapping a TPU into them just to make a
 * row pass would produce an export that is wrong but looks right
 * (docs/SPEC.md).
 */

export const PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  "1": "ยาแผนปัจจุบัน · ผลิตภัณฑ์ทางการค้า",
  "2": "ยาแผนปัจจุบัน · ผลิต/ปรุง/แบ่งบรรจุใช้เอง",
  "3": "ยาแผนไทย/สมุนไพร · ผลิตภัณฑ์ทางการค้า",
  "4": "ยาแผนไทย/สมุนไพร · ผลิตใช้เอง",
  "5": "การรักษาทางเลือกอื่น",
  "6": "เวชภัณฑ์",
  "7": "อื่น ๆ",
};

export type DrugType = "01" | "10";
export type StandardType = "TMT" | "TTMT";

const HOSPITAL_PREPARED = new Set(["2", "4"]);
const SPEC_PREP_PATTERN = /^[RMFX][1-9A-Z]$/;

export class MappingRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MappingRuleError";
  }
}

/** drugtype 01 uses TMT; drugtype 10 uses TTMT. */
export function standardTypeForDrugType(drugType: string): StandardType {
  if (drugType === "10") return "TTMT";
  if (drugType === "01") return "TMT";
  throw new MappingRuleError("DRUGTYPE_UNSUPPORTED", `drugtype ${drugType} อยู่นอกขอบเขตของระบบ (รองรับเฉพาะ 01 และ 10)`);
}

export function defaultProductCategory(drugType: string): string {
  return drugType === "10" ? "3" : "1";
}

export function allowedProductCategories(drugType: string): string[] {
  return drugType === "10" ? ["3"] : ["1"];
}

export function resolveProductCategory(drugType: string, value: string | null | undefined): string {
  const category = (value ?? "").trim() || defaultProductCategory(drugType);
  const allowed = allowedProductCategories(drugType);
  if (!allowed.includes(category)) {
    throw new MappingRuleError(
      "PRODUCTCAT_UNSUPPORTED",
      `PRODUCTCAT ไม่สัมพันธ์กับคลังรหัสที่ระบบรองรับสำหรับ drugtype ${drugType} ` +
        `(ใช้ได้เฉพาะ ${allowed.join(" หรือ ")}); รายการผลิต/แบ่งบรรจุเองต้องใช้คลัง TMT ระดับ TP/GP-F/GP-X แยกจาก TPU`,
    );
  }
  return category;
}

export function normalizeSpecPrep(category: string, value: string | null | undefined): string | null {
  const specPrep = (value ?? "").trim().toUpperCase();
  const hospitalPrepared = HOSPITAL_PREPARED.has(category);
  if (hospitalPrepared && !SPEC_PREP_PATTERN.test(specPrep)) {
    throw new MappingRuleError(
      "SPECPREP_REQUIRED",
      "ยาที่ผลิต/ปรุง/แบ่งบรรจุใช้เอง ต้องระบุ SPECPREP 2 ตำแหน่ง เช่น R1, M1, F1 หรือ X1",
    );
  }
  if (!hospitalPrepared && specPrep !== "") {
    throw new MappingRuleError("SPECPREP_MUST_BE_EMPTY", "ผลิตภัณฑ์ทางการค้าต้องเว้น SPECPREP ว่าง");
  }
  return specPrep !== "" ? specPrep : null;
}
