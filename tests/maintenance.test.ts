import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  readMaintenanceState,
  setMaintenanceMode,
  type MaintenanceStore,
  type StoredMaintenanceSetting,
} from "@/modules/maintenance/service";

class MemoryStore implements MaintenanceStore {
  row: StoredMaintenanceSetting | null = null;
  transitions: Array<{ valueEncrypted: string; actorUserId: string; action: string }> = [];

  async read() { return this.row; }
  async transition(input: { valueEncrypted: string; actorUserId: string; action: string; at: Date }) {
    this.transitions.push(input);
    this.row = { valueEncrypted: input.valueEncrypted, updatedBy: input.actorUserId, updatedAt: input.at };
  }
}

beforeEach(() => vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64")));
afterEach(() => vi.unstubAllEnvs());

test("maintenance defaults off and stores encrypted audited state", async () => {
  const store = new MemoryStore();
  assert.deepEqual(await readMaintenanceState(store), {
    available: true, enabled: false, reason: null, changedBy: null, changedAt: null,
  });

  const result = await setMaintenanceMode({ enabled: true, reason: "Phase 7", actorUserId: "admin-1", now: new Date("2026-11-09T06:00:00Z") }, store);
  assert.equal(result.changed, true);
  assert.equal(store.transitions.length, 1);
  assert.equal(store.transitions[0]?.action, "maintenance.enabled");
  assert.doesNotMatch(store.transitions[0]?.valueEncrypted ?? "", /Phase 7/);
  assert.deepEqual(await readMaintenanceState(store), {
    available: true, enabled: true, reason: "Phase 7", changedBy: "admin-1", changedAt: "2026-11-09T06:00:00.000Z",
  });
});

test("same-state transition is idempotent and malformed state fails closed", async () => {
  const store = new MemoryStore();
  await setMaintenanceMode({ enabled: true, reason: "Phase 7", actorUserId: "admin-1", now: new Date("2026-11-09T06:00:00Z") }, store);
  const repeated = await setMaintenanceMode({ enabled: true, reason: "ignored", actorUserId: "admin-2", now: new Date("2026-11-09T07:00:00Z") }, store);
  assert.equal(repeated.changed, false);
  assert.equal(store.transitions.length, 1);

  store.row = { valueEncrypted: "broken", updatedBy: null, updatedAt: new Date() };
  const state = await readMaintenanceState(store);
  assert.equal(state.available, false);
  assert.equal(state.enabled, true);
});
