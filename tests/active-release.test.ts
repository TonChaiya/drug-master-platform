import assert from "node:assert/strict";
import { test } from "vitest";
import { activeStandardReleaseEnabled } from "@/modules/tmt/feature";
import { ACTIVE_STANDARD_RELEASE_POINTER_KEY, ActiveStandardReleaseError, readActiveStandardRelease, readLockedActiveStandardRelease } from "@/modules/standards/active-release";

test("active release flag is disabled unless exact opt-in", () => {
  assert.equal(activeStandardReleaseEnabled({}), false);
  assert.equal(activeStandardReleaseEnabled({ ACTIVE_STANDARD_RELEASE_ENABLED: "1" }), true);
});
test("resolver rejects a missing or invalid pointer", async () => {
  const pool = { query: async () => [[]] } as never;
  await assert.rejects(() => readActiveStandardRelease(pool), ActiveStandardReleaseError);
  assert.equal(ACTIVE_STANDARD_RELEASE_POINTER_KEY, "active-standard-release");
});

test("resolver accepts only an approved validated TMT/TTMT release and uses the fixed pointer", async () => {
  const row = {
    release_id: "release-1", tmt_dataset_id: "tmt-1", ttmt_dataset_id: "ttmt-1",
    release_state: "approved", approved_at: new Date(), tmt_state: "validated", tmt_source: "TMT",
    ttmt_state: "validated", ttmt_source: "TTMT", validation_status: "passed",
  };
  const calls: unknown[][] = [];
  const pool = { query: async (...args: unknown[]) => { calls.push(args); return [[row]]; } } as never;
  assert.deepEqual(await readActiveStandardRelease(pool), { releaseId: "release-1", tmtDatasetId: "tmt-1", ttmtDatasetId: "ttmt-1" });
  assert.deepEqual(calls[0]?.[1], [ACTIVE_STANDARD_RELEASE_POINTER_KEY]);
});

test("transaction resolver validates the locked pointer result", async () => {
  const row = {
    release_id: "release-2", tmt_dataset_id: "tmt-2", ttmt_dataset_id: "ttmt-2",
    release_state: "approved", approved_at: new Date(), tmt_state: "validated", tmt_source: "TMT",
    ttmt_state: "validated", ttmt_source: "TTMT", validation_status: "passed",
  };
  const executor = { execute: async () => [[row]] } as never;
  assert.equal((await readLockedActiveStandardRelease(executor)).releaseId, "release-2");
});
