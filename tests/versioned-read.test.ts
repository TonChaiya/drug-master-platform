import assert from "node:assert/strict";
import { test } from "vitest";
import { findVersionedTmtConcepts, findVersionedTtmtProduct } from "@/modules/standards/versioned-read";
const release = { releaseId: "r", tmtDatasetId: "t", ttmtDatasetId: "u" };
test("versioned readers bind their matching dataset IDs", async () => {
  const calls: unknown[][] = []; const pool = { query: async (_sql: string, params: unknown[]) => { calls.push(params); return [[]]; } } as never;
  await findVersionedTmtConcepts(pool, release, "1"); await findVersionedTtmtProduct(pool, release, "x");
  assert.deepEqual(calls, [["t", "1"], ["u", "x"]]);
});
