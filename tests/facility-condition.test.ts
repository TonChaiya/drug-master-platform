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
    agentCount: 1,
    agentMismatchCount: 0,
    accountCount: 1,
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

test("no account outranks every other problem", () => {
  // Nobody can sign in to fix the mapping, so reporting the mapping is useless.
  const condition = facilityCondition(summary({ accountCount: 0, agentCount: 0, sourceTotal: 0, pendingTotal: 5 }));
  assert.equal(condition.tone, "danger");
  assert.equal(condition.label, "ไม่มีบัญชีผู้ใช้");
});

test("an agent declaring the wrong office is reported as broken, not as connected", () => {
  const condition = facilityCondition(summary({ agentCount: 2, agentMismatchCount: 2 }));
  assert.equal(condition.tone, "danger");
  assert.equal(condition.label, "Agent รหัสไม่ตรง");
  assert.match(condition.detail, /05957/);
});

test("a facility with accounts but no agent is waiting on installation", () => {
  const condition = facilityCondition(summary({ agentCount: 0, sourceTotal: 0, mappedTotal: 0 }));
  assert.equal(condition.tone, "warning");
  assert.equal(condition.label, "ยังไม่มี Agent");
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

test("percentage is whole and never divides by zero", () => {
  assert.equal(mappedPercent({ sourceTotal: 188, mappedTotal: 187 }), 99);
  assert.equal(mappedPercent({ sourceTotal: 188, mappedTotal: 188 }), 100);
  assert.equal(mappedPercent({ sourceTotal: 0, mappedTotal: 0 }), 0);
});
