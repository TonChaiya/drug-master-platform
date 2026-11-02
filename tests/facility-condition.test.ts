import assert from "node:assert/strict";
import { test } from "vitest";
import { facilityCondition, mappedPercent } from "@/modules/admin/condition";
import type { FacilitySummary } from "@/modules/admin/queries";

/**
 * This decides the one word the admin overview says about each facility, so a
 * wrong answer here sends someone to fix the wrong thing. The order is the
 * point: several of these hold at once on a facility that was set up this
 * morning, and the row has to name the earliest blocker rather than the last.
 */
function summary(overrides: Partial<FacilitySummary> = {}): FacilitySummary {
  return {
    facilityId: "f1",
    facilityCode: "05957",
    facilityName: "รพ.สต.ทดสอบ",
    sourceTotal: 188,
    type01: 171,
    type10: 17,
    mappedTotal: 188,
    pendingTotal: 0,
    needsReviewTotal: 0,
    exportReadyTotal: 188,
    installationCount: 1,
    agentCount: 1,
    disabledAgentCount: 0,
    supersededAgentCount: 0,
    usableAgentCount: 1,
    onlineAgentCount: 1,
    offlineAgentCount: 0,
    jhcisConnectedCount: 1,
    jhcisUnreachableCount: 0,
    jhcisUnknownCount: 0,
    agentMismatchCount: 0,
    activeAccountCount: 1,
    pendingAccountCount: 0,
    disabledAccountCount: 0,
    totalAccountCount: 1,
    lastMappedAt: new Date("2026-09-04T03:29:00Z"),
    ...overrides,
  };
}

test("a facility with everything in place is ready to export", () => {
  const condition = facilityCondition(summary());
  assert.equal(condition.tone, "success");
  assert.equal(condition.label, "พร้อมส่งออก");
  assert.equal(condition.needsAttention, false);
});

test("no active account outranks every other problem even when pending accounts exist", () => {
  // Nobody can sign in to fix the mapping, so reporting the mapping is useless.
  const condition = facilityCondition(summary({ activeAccountCount: 0, pendingAccountCount: 2, totalAccountCount: 2, agentCount: 0, sourceTotal: 0, pendingTotal: 5 }));
  assert.equal(condition.tone, "danger");
  assert.equal(condition.label, "รออนุมัติ 2");
});

test("disabled-only accounts are not usable while active plus pending remains usable", () => {
  assert.equal(
    facilityCondition(summary({ activeAccountCount: 0, disabledAccountCount: 1, totalAccountCount: 1 })).label,
    "ไม่มีบัญชีใช้งาน",
  );
  assert.equal(
    facilityCondition(summary({ activeAccountCount: 2, pendingAccountCount: 1, totalAccountCount: 3 })).tone,
    "success",
  );
});

test("an agent declaring the wrong office is reported as broken, not as connected", () => {
  const condition = facilityCondition(summary({ agentCount: 2, agentMismatchCount: 2 }));
  assert.equal(condition.tone, "danger");
  assert.equal(condition.label, "Agent รหัสไม่ตรง");
  assert.match(condition.detail, /05957/);
});

test("a facility with accounts but no agent is waiting on installation", () => {
  const condition = facilityCondition(summary({ installationCount: 0, agentCount: 0, sourceTotal: 0, mappedTotal: 0 }));
  assert.equal(condition.tone, "warning");
  assert.equal(condition.label, "ยังไม่มี Agent");
});

test("disabled or superseded installations are present but never usable", () => {
  const condition = facilityCondition(summary({
    installationCount: 2,
    agentCount: 0,
    disabledAgentCount: 1,
    supersededAgentCount: 1,
    usableAgentCount: 0,
    onlineAgentCount: 0,
  }));
  assert.equal(condition.tone, "danger");
  assert.equal(condition.label, "ไม่มี Agent ที่ใช้งาน");
});

test("an agent that has never sent drugs is told apart from one that has", () => {
  const condition = facilityCondition(summary({ sourceTotal: 0, mappedTotal: 0, type01: 0, type10: 0 }));
  assert.equal(condition.label, "ยังไม่มีรายการยา");
});

test("outstanding mappings are counted in the label", () => {
  const condition = facilityCondition(summary({ mappedTotal: 187, pendingTotal: 1 }));
  assert.equal(condition.tone, "warning");
  assert.equal(condition.label, "ค้างจับคู่ 1");
});

test("needs-review outranks pending and never reports ready", () => {
  const condition = facilityCondition(summary({ mappedTotal: 185, needsReviewTotal: 2, pendingTotal: 1 }));
  assert.equal(condition.tone, "warning");
  assert.equal(condition.label, "ต้องตรวจสอบ 2");
});

test("mapped lifecycle with invalid standard is not reported ready to export", () => {
  const condition = facilityCondition(summary({ exportReadyTotal: 187 }));
  assert.equal(condition.tone, "warning");
  assert.equal(condition.label, "มาตรฐานไม่พร้อม 1");
});

test("active installation without usable credential is not ready", () => {
  const condition = facilityCondition(summary({ usableAgentCount: 0, onlineAgentCount: 0, offlineAgentCount: 1 }));
  assert.equal(condition.tone, "danger");
  assert.equal(condition.label, "Agent ใช้งานไม่ได้");
});

test("offline Agent and unreachable JHCIS are distinct blockers", () => {
  assert.equal(
    facilityCondition(summary({ onlineAgentCount: 0, offlineAgentCount: 1, jhcisConnectedCount: 0 })).label,
    "Agent ออฟไลน์",
  );
  assert.equal(
    facilityCondition(summary({ jhcisConnectedCount: 0, jhcisUnreachableCount: 1 })).label,
    "JHCIS ติดต่อไม่ได้",
  );
});

test("unknown JHCIS state never reports the facility ready", () => {
  const condition = facilityCondition(summary({ jhcisConnectedCount: 0, jhcisUnknownCount: 1 }));
  assert.equal(condition.tone, "warning");
  assert.equal(condition.label, "ยังไม่ทราบสถานะ JHCIS");
});

test("percentage is whole and never divides by zero", () => {
  assert.equal(mappedPercent({ sourceTotal: 188, mappedTotal: 187 }), 99);
  assert.equal(mappedPercent({ sourceTotal: 188, mappedTotal: 188 }), 100);
  assert.equal(mappedPercent({ sourceTotal: 0, mappedTotal: 0 }), 0);
});
