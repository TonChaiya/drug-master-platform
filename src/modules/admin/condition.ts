import type { FacilitySummary } from "./queries";

export type ConditionTone = "success" | "warning" | "danger" | "neutral";

export interface FacilityCondition {
  tone: ConditionTone;
  /** Two or three words, for the badge. */
  label: string;
  /** One sentence saying what is wrong and what would fix it. */
  detail: string;
  /** False when the facility needs no attention; the row then stays one line. */
  needsAttention: boolean;
}

/**
 * Turns a facility's counters into the one thing an admin actually wants from
 * the overview: is this place working, and if not, what is holding it up.
 *
 * The table showed six bare numbers per row and left the reader to combine them
 * — a row of zeroes could equally mean "set up this morning" or "broken since
 * last week", and those need opposite responses.
 *
 * Order matters: the first condition that holds wins, and they are arranged so
 * the earliest blocker in the setup sequence is reported. Telling someone their
 * mapping is incomplete is useless when nobody can even sign in to do it.
 */
export function facilityCondition(summary: FacilitySummary): FacilityCondition {
  if (summary.accountCount === 0) {
    return {
      tone: "danger",
      label: "ไม่มีบัญชีผู้ใช้",
      detail: "ยังไม่มีไอดีผูกกับสถานบริการนี้ จึงไม่มีใครเข้าใช้งานได้ ต้องให้เจ้าหน้าที่สมัครแล้วอนุมัติก่อน",
      needsAttention: true,
    };
  }

  if (summary.agentMismatchCount > 0) {
    return {
      tone: "danger",
      label: "Agent รหัสไม่ตรง",
      detail: `Agent ${summary.agentMismatchCount.toLocaleString("th-TH")} เครื่องรายงาน office.offid ไม่ตรงกับรหัส ${summary.facilityCode} ทุกคำขอจึงถูกปฏิเสธ`,
      needsAttention: true,
    };
  }

  if (summary.agentCount === 0) {
    return {
      tone: "warning",
      label: "ยังไม่มี Agent",
      detail: "ยังไม่มีเครื่องใดลงทะเบียน ต้องติดตั้ง Agent บนเครื่องในวง LAN เดียวกับ JHCIS ก่อนจึงจะดึงรายการยาได้",
      needsAttention: true,
    };
  }

  if (summary.sourceTotal === 0) {
    return {
      tone: "warning",
      label: "ยังไม่มีรายการยา",
      detail: "Agent ลงทะเบียนแล้วแต่ยังไม่มีรายการยาส่งเข้ามา สั่ง “ดึงรายการยาตอนนี้” จากหน้าเชื่อมต่อ JHCIS",
      needsAttention: true,
    };
  }

  if (summary.pendingTotal > 0) {
    return {
      tone: "warning",
      label: `ค้างจับคู่ ${summary.pendingTotal.toLocaleString("th-TH")}`,
      detail: `เหลือ ${summary.pendingTotal.toLocaleString("th-TH")} รายการที่ยังไม่มีรหัสมาตรฐาน จึงยังไม่ถูกรวมในไฟล์ส่งออก`,
      needsAttention: true,
    };
  }

  return {
    tone: "success",
    label: "พร้อมส่งออก",
    detail: "แหล่งข้อมูลครบและจับคู่ครบทุกรายการ",
    needsAttention: false,
  };
}

/** Percentage of active JHCIS drugs that carry a standard code, 0–100. */
export function mappedPercent(summary: Pick<FacilitySummary, "sourceTotal" | "mappedTotal">): number {
  if (summary.sourceTotal <= 0) return 0;
  return Math.round((summary.mappedTotal / summary.sourceTotal) * 100);
}
