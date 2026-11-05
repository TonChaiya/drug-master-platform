import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tmtConcept, tmtMastertmt, ttmtImports, ttmtProducts } from "@/db/schema";

export const MAPPING_STANDARD_SOURCES = ["TMT", "TTMT"] as const;
export type MappingStandardSource = (typeof MAPPING_STANDARD_SOURCES)[number];

export const TMT_MAPPING_LEVELS = ["subs", "vtm", "gp", "gpu", "gpp", "tp", "tpu", "tpp"] as const;
export type TmtMappingLevel = (typeof TMT_MAPPING_LEVELS)[number];
export const TTMT_MAPPING_LEVEL = "product" as const;

export class MappingV2RuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MappingV2RuleError";
  }
}

export type MappingV2Evaluation = { eligible: true; reason: null } | { eligible: false; reason: string };

export type MappingV2EvaluationInput =
  | {
      source: "TMT";
      code: string;
      level: string;
      productCat: string;
      exists: boolean;
      conceptLevel?: string | null;
      masterStatus?: number | null;
    }
  | {
      source: "TTMT";
      code: string;
      level: string;
      productCat: string;
      exists: boolean;
      ttmtStatus?: string | null;
      importSucceeded?: boolean | null;
    };

/** Pure eligibility rule shared by the DB resolver and tests; UI never decides this. */
export function evaluateMappingV2Standard(input: MappingV2EvaluationInput): MappingV2Evaluation {
  if (!input.exists) return { eligible: false, reason: "ไม่พบรายการมาตรฐานที่เลือก" };
  if (input.source === "TMT") {
    if (input.productCat !== "1") {
      return { eligible: false, reason: "ยังไม่มีกฎ TMT v2 ที่ยืนยันได้สำหรับ PRODUCTCAT นี้" };
    }
    if (input.level === "gpu") return { eligible: false, reason: "เป็นระดับ GPU กรุณาเลือก TPU ที่เกี่ยวข้อง" };
    if (input.level !== "tpu") return { eligible: false, reason: "PRODUCTCAT 1 ต้องเลือกรายการ TPU ที่มีสถานะใช้งานอยู่" };
    if (input.conceptLevel !== input.level) return { eligible: false, reason: "ระดับของรหัส TMT ไม่ตรงกับข้อมูลมาตรฐาน" };
    if (input.masterStatus === 0) return { eligible: true, reason: null };
    if (input.masterStatus === 1) return { eligible: false, reason: "รายการ TPU ถูกยกเลิก" };
    return { eligible: false, reason: "ยังยืนยันสถานะรายการสำหรับการจับคู่ไม่ได้" };
  }

  if (input.productCat !== "3") return { eligible: false, reason: "TTMT รองรับเฉพาะ PRODUCTCAT 3 ตามข้อมูลที่ยืนยันแล้ว" };
  if (input.level !== TTMT_MAPPING_LEVEL) return { eligible: false, reason: "TTMT ไม่มีลำดับชั้น TMT กรุณาเลือกรายการผลิตภัณฑ์ TTMT" };
  if (input.importSucceeded === false) return { eligible: false, reason: "ข้อมูล TTMT มาจากการนำเข้าที่ยังไม่สมบูรณ์" };
  if (input.ttmtStatus === "active") return { eligible: true, reason: null };
  return { eligible: false, reason: "รายการ TTMT ไม่อยู่ในสถานะใช้งาน" };
}

export interface ResolvedMappingV2Standard {
  source: MappingStandardSource;
  code: string;
  level: string;
  fsn: string | null;
  sourceVersion: string | null;
  eligible: boolean;
  reason: string | null;
}

export async function resolveMappingV2Standard(input: {
  source: MappingStandardSource;
  code: string;
  level: string;
  productCat: string;
}): Promise<ResolvedMappingV2Standard> {
  if (input.source === "TMT") {
    let tmtid: bigint;
    try {
      tmtid = BigInt(input.code);
    } catch {
      throw new MappingV2RuleError("STANDARD_CODE_INVALID", "รหัส TMT ต้องเป็นตัวเลขเท่านั้น");
    }
    if (tmtid < 0n) throw new MappingV2RuleError("STANDARD_CODE_INVALID", "รหัส TMT ต้องเป็นตัวเลขเท่านั้น");
    const [row] = await db
      .select({ level: tmtConcept.levelName, fsn: tmtConcept.fsn, sourceVersion: tmtConcept.sourceVersion, masterStatus: tmtMastertmt.status })
      .from(tmtConcept)
      .leftJoin(tmtMastertmt, eq(tmtMastertmt.tpucode, tmtConcept.tmtid))
      .where(eq(tmtConcept.tmtid, tmtid))
      .limit(1);
    const evaluation = evaluateMappingV2Standard({
      source: "TMT",
      code: input.code,
      level: input.level,
      productCat: input.productCat,
      exists: Boolean(row),
      conceptLevel: row?.level,
      masterStatus: row?.masterStatus ?? null,
    });
    return { source: "TMT", code: input.code, level: input.level, fsn: row?.fsn ?? null, sourceVersion: row?.sourceVersion ?? null, ...evaluation };
  }

  const [row] = await db
    .select({ fsn: ttmtProducts.fsn, sourceVersion: ttmtProducts.sourceVersion, status: ttmtProducts.status, importStatus: ttmtImports.status })
    .from(ttmtProducts)
    .innerJoin(ttmtImports, eq(ttmtImports.id, ttmtProducts.sourceImportId))
    .where(eq(ttmtProducts.ttmtcode, input.code))
    .limit(1);
  const evaluation = evaluateMappingV2Standard({
    source: "TTMT",
    code: input.code,
    level: input.level,
    productCat: input.productCat,
    exists: Boolean(row),
    ttmtStatus: row?.status,
    importSucceeded: row?.importStatus === "succeeded",
  });
  return { source: "TTMT", code: input.code, level: input.level, fsn: row?.fsn ?? null, sourceVersion: row?.sourceVersion ?? null, ...evaluation };
}

export async function requireEligibleMappingV2Standard(input: {
  source: MappingStandardSource;
  code: string;
  level: string;
  productCat: string;
}): Promise<ResolvedMappingV2Standard> {
  const resolved = await resolveMappingV2Standard(input);
  if (!resolved.eligible) throw new MappingV2RuleError("STANDARD_NOT_ELIGIBLE", resolved.reason ?? "รายการมาตรฐานไม่พร้อมใช้งาน");
  return resolved;
}
