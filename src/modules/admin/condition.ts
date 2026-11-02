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
  if (summary.activeAccountCount === 0) {
    if (summary.pendingAccountCount > 0) {
      return {
        tone: "danger",
        label: `รออนุมัติ ${summary.pendingAccountCount.toLocaleString("th-TH")}`,
        detail: "ยังไม่มีบัญชีที่เปิดใช้งาน ต้องอนุมัติบัญชีก่อนจึงจะมีผู้ใช้แก้ไขข้อมูลได้",
        needsAttention: true,
      };
    }
    return {
      tone: "danger",
      label: "ไม่มีบัญชีใช้งาน",
      detail:
        summary.totalAccountCount > 0
          ? "บัญชีของสถานบริการนี้ถูกปิดใช้งานทั้งหมด จึงไม่มีใครเข้าใช้งานได้"
          : "ยังไม่มีไอดีผูกกับสถานบริการนี้ จึงไม่มีใครเข้าใช้งานได้ ต้องให้เจ้าหน้าที่สมัครแล้วอนุมัติก่อน",
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

  if (summary.installationCount === 0) {
    return {
      tone: "warning",
      label: "ยังไม่มี Agent",
      detail: "ยังไม่มีเครื่องใดลงทะเบียน ต้องติดตั้ง Agent บนเครื่องในวง LAN เดียวกับ JHCIS ก่อนจึงจะดึงรายการยาได้",
      needsAttention: true,
    };
  }

  if (summary.agentCount === 0) {
    return {
      tone: "danger",
      label: "ไม่มี Agent ที่ใช้งาน",
      detail: "มี installation เดิมแต่ถูก disabled หรือ superseded ทั้งหมด ต้องเปิดใช้หรือ re-enroll เครื่องที่ถูกต้อง",
      needsAttention: true,
    };
  }

  if (summary.usableAgentCount === 0) {
    return {
      tone: "danger",
      label: "Agent ใช้งานไม่ได้",
      detail: "มี installation แต่ไม่มี credential ที่ใช้งานได้ ต้องลงทะเบียน Agent ใหม่",
      needsAttention: true,
    };
  }

  if (summary.onlineAgentCount === 0) {
    return {
      tone: "warning",
      label: "Agent ออฟไลน์",
      detail: "Agent ลงทะเบียนแล้วแต่ heartbeat ไม่สด ตรวจว่าโปรแกรมกำลังทำงานและเชื่อมต่อ Central ได้",
      needsAttention: true,
    };
  }

  if (summary.jhcisConnectedCount === 0 && summary.jhcisUnreachableCount > 0) {
    return {
      tone: "warning",
      label: "JHCIS ติดต่อไม่ได้",
      detail: "Agent ออนไลน์ แต่ heartbeat ล่าสุดรายงานว่าเชื่อมต่อฐาน JHCIS ไม่ได้",
      needsAttention: true,
    };
  }

  if (summary.jhcisConnectedCount === 0 && summary.jhcisUnknownCount > 0) {
    return {
      tone: "warning",
      label: "ยังไม่ทราบสถานะ JHCIS",
      detail: "Agent ออนไลน์ แต่ยังไม่มีผลตรวจ JHCIS ที่สดพอ จึงยังสรุปว่าพร้อมไม่ได้",
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

  if (summary.needsReviewTotal > 0) {
    return {
      tone: "warning",
      label: `ต้องตรวจสอบ ${summary.needsReviewTotal.toLocaleString("th-TH")}`,
      detail: `มี ${summary.needsReviewTotal.toLocaleString("th-TH")} รายการที่ mapping/catalog เปลี่ยนและต้องตรวจสอบก่อนส่งออก`,
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

  if (summary.exportReadyTotal < summary.mappedTotal) {
    const blocked = summary.mappedTotal - summary.exportReadyTotal;
    return {
      tone: "warning",
      label: `มาตรฐานไม่พร้อม ${blocked.toLocaleString("th-TH")}`,
      detail: `มี ${blocked.toLocaleString("th-TH")} mapping ที่มาตรฐาน inactive, ไม่พบ หรือชนิดไม่ตรง จึงไม่อยู่ในชุดส่งออก`,
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
