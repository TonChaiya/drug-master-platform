import { beforeEach, test, vi } from "vitest";
import { strict as assert } from "node:assert";
import { agentCredentials, agentInstallations } from "@/db/schema";

interface MutationRecord {
  table: unknown;
  values?: Record<string, unknown>;
}

const fake = vi.hoisted(() => {
  const state = {
    selects: [] as Array<Array<Record<string, unknown>>>,
    updateResults: [] as number[],
    updates: [] as MutationRecord[],
    inserts: [] as MutationRecord[],
    deletes: [] as MutationRecord[],
  };

  function select() {
    const chain = {
      from: (...args: unknown[]) => (void args, chain),
      innerJoin: (...args: unknown[]) => (void args, chain),
      where: (...args: unknown[]) => (void args, chain),
      orderBy: (...args: unknown[]) => (void args, chain),
      limit: (...args: unknown[]) => (void args, Promise.resolve(state.selects.shift() ?? [])),
    };
    return chain;
  }

  function update(table: unknown) {
    return {
      set(values: Record<string, unknown>) {
        return {
          where: (...args: unknown[]) => {
            void args;
            state.updates.push({ table, values });
            return Promise.resolve([{ affectedRows: state.updateResults.shift() ?? 1 }]);
          },
        };
      },
    };
  }

  function insert(table: unknown) {
    return {
      values: (values: Record<string, unknown>) => {
        state.inserts.push({ table, values });
        return Promise.resolve();
      },
    };
  }

  function remove(table: unknown) {
    return {
      where: (...args: unknown[]) => {
        void args;
        state.deletes.push({ table });
        return Promise.resolve([{ affectedRows: 1 }]);
      },
    };
  }

  interface FakeDb {
    select: typeof select;
    update: typeof update;
    insert: typeof insert;
    delete: typeof remove;
    transaction: <T>(callback: (transaction: FakeDb) => Promise<T>) => Promise<T>;
  }
  const db: FakeDb = {
    select,
    update,
    insert,
    delete: remove,
    transaction: <T>(callback: (transaction: FakeDb) => Promise<T>) => callback(db),
  };
  return { db, state };
});

vi.mock("@/db/client", () => ({ db: fake.db }));
vi.mock("@/lib/crypto/secret-box", () => ({ encryptSecret: () => "encrypted" }));

import { deleteUnusedInstallation, disableInstallation, supersedeInstallation } from "@/modules/agent/admin";
import { redeemEnrollment } from "@/modules/agent/enrollment";

const facilityId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requestedId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";

function enrollment(targetInstallationId: string | null = null) {
  return {
    tokenId: "33333333-3333-4333-8333-333333333333",
    facilityId,
    createdBy: actorUserId,
    targetInstallationId,
    facilityCode: "05957",
    facilityStatus: "active",
  };
}

function input(installationId = requestedId) {
  return {
    enrollmentToken: "t".repeat(43),
    installationId,
    machineLabel: "JHCIS-PC",
    officeId: "05957",
    agentVersion: "1.2.3",
    macAddress: "00:11:22:33:44:55" as const,
  };
}

beforeEach(() => {
  fake.state.selects.length = 0;
  fake.state.updateResults.length = 0;
  fake.state.updates.length = 0;
  fake.state.inserts.length = 0;
  fake.state.deletes.length = 0;
});

test("same installation re-enrollment updates one installation row", async () => {
  fake.state.selects.push([enrollment()], [], [{ installationId: requestedId }]);
  const issued = await redeemEnrollment(input());

  assert.equal(issued.installationId, requestedId);
  assert.equal(fake.state.inserts.filter((row) => row.table === agentInstallations).length, 0);
  assert.equal(fake.state.updates.filter((row) => row.table === agentInstallations).length, 1);
});

test("target re-enrollment uses the existing canonical id", async () => {
  fake.state.selects.push([enrollment(targetId)], [{ installationId: targetId }], [{ installationId: targetId }]);
  const issued = await redeemEnrollment(input());
  const credential = fake.state.inserts.find((row) => row.table === agentCredentials);

  assert.equal(issued.installationId, targetId);
  assert.equal(credential?.values?.installationId, targetId);
});

test("same MAC and hostname with a new id is rejected without consuming the token", async () => {
  fake.state.selects.push([enrollment()], [{ installationId: targetId }]);

  await assert.rejects(redeemEnrollment(input()), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "AGENT_POSSIBLE_DUPLICATE"
  ));
  assert.equal(fake.state.updates.length, 0);
  assert.equal(fake.state.inserts.length, 0);
});

test("conditional token redemption stops the losing concurrent request", async () => {
  fake.state.selects.push([enrollment()], []);
  fake.state.updateResults.push(0);

  await assert.rejects(redeemEnrollment(input()), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "AGENT_ENROLLMENT_INVALID"
  ));
  assert.equal(fake.state.inserts.length, 0);
});

test("cross-facility target re-enrollment is rejected", async () => {
  fake.state.selects.push([enrollment(targetId)], []);

  await assert.rejects(redeemEnrollment(input()), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "AGENT_ENROLLMENT_INVALID"
  ));
  assert.equal(fake.state.updates.length, 0);
});

test("facility and JHCIS office mismatch fails closed", async () => {
  fake.state.selects.push([{ ...enrollment(), facilityCode: "05958" }]);

  await assert.rejects(redeemEnrollment(input()), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "AGENT_OFFICE_MISMATCH"
  ));
  assert.equal(fake.state.updates.length, 0);
  assert.equal(fake.state.inserts.length, 0);
});

test("new credential explicitly replaces older active credentials", async () => {
  fake.state.selects.push([enrollment()], [], [{ installationId: requestedId }]);
  await redeemEnrollment(input());
  const credentialInsert = fake.state.inserts.find((row) => row.table === agentCredentials);
  const replacementUpdate = fake.state.updates.find(
    (row) => row.table === agentCredentials && row.values?.supersededByCredentialId,
  );

  assert.equal(replacementUpdate?.values?.supersededByCredentialId, credentialInsert?.values?.id);
});

test("disable revokes credentials and writes audit in one transaction", async () => {
  fake.state.selects.push([{ installationId: requestedId, status: "active" }]);
  await disableInstallation({ facilityId, installationId: requestedId, actorUserId });

  assert.equal(fake.state.updates.some((row) => row.table === agentInstallations && row.values?.status === "disabled"), true);
  assert.equal(fake.state.updates.some((row) => row.table === agentCredentials && row.values?.revokedAt instanceof Date), true);
  assert.equal(fake.state.inserts.some((row) => row.values?.action === "agent.disabled"), true);
});

test("supersede revokes only the selected old installation and preserves rows", async () => {
  fake.state.selects.push(
    [{ installationId: requestedId, status: "active" }],
    [{ installationId: targetId, status: "active" }],
  );
  await supersedeInstallation({ facilityId, oldInstallationId: requestedId, currentInstallationId: targetId, actorUserId });

  assert.equal(fake.state.updates.some((row) => row.values?.status === "superseded" && row.values?.supersededByInstallationId === targetId), true);
  assert.equal(fake.state.deletes.length, 0);
  assert.equal(fake.state.inserts.some((row) => row.values?.action === "agent.superseded"), true);
});

test("unsafe hard delete and cross-facility administration are rejected", async () => {
  fake.state.selects.push(
    [{ installationId: requestedId, machineLabel: "PC", status: "active" }],
    [{ id: "used-key" }],
    [],
    [],
  );
  await assert.rejects(
    deleteUnusedInstallation({ facilityId, installationId: requestedId, actorUserId }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "AGENT_HAS_HISTORY",
  );
  assert.equal(fake.state.deletes.length, 0);

  fake.state.selects.push([]);
  await assert.rejects(
    disableInstallation({ facilityId, installationId: targetId, actorUserId }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "AGENT_NOT_FOUND",
  );
});
