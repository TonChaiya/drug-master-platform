import type { KnownTmtLevel } from "./presentation";

export type TmtLevel = KnownTmtLevel | string;
export type TmtKnownStatus = "active" | "cancelled" | "unknown";

export interface TmtMappingEligibility {
  eligible: boolean;
  reason: string;
}

export interface TmtRelationshipCounts {
  inbound: number;
  outbound: number;
  inboundByLevel: Record<string, number>;
  outboundByLevel: Record<string, number>;
}

export interface TmtSearchResult {
  tmtId: string;
  level: string;
  conceptFsn: string;
  endpointFsn: string | null;
  manufacturer: string | null;
  status: TmtKnownStatus;
  masterStatus: number | null;
  sourceVersion: string;
  mappingEligible: boolean;
  mappingEligibilityReason: string;
  dataQualityWarnings: string[];
  relationships: TmtRelationshipCounts;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: string | null;
  contentValue: string | null;
  contentUnit: string | null;
  dispensingUnit: string | null;
  tradeName: string | null;
}

export interface LatestTmtValues {
  changeDate: string;
  values: string[];
  conflict: boolean;
}

export function mappingEligibility(level: string, masterStatus: number | null): TmtMappingEligibility {
  if (level === "gpu") return { eligible: false, reason: "เป็นระดับ GPU กรุณาเลือกรายการ TPU ที่เกี่ยวข้อง" };
  if (level !== "tpu") return { eligible: false, reason: "การจับคู่เชิงพาณิชย์รองรับเฉพาะระดับ TPU" };
  if (masterStatus === 0) return { eligible: true, reason: "พร้อมสำหรับการจับคู่แบบ commercial TPU" };
  if (masterStatus === 1) return { eligible: false, reason: "รายการ TPU ถูกยกเลิก" };
  return { eligible: false, reason: "ยังยืนยันสถานะรายการสำหรับการจับคู่ไม่ได้" };
}

export function masterTmtStatus(status: number | null): TmtKnownStatus {
  if (status === 0) return "active";
  if (status === 1) return "cancelled";
  return "unknown";
}
