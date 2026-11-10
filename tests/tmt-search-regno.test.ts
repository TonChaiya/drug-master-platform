import assert from "node:assert/strict";
import { test } from "vitest";
import type { Pool } from "mysql2/promise";
import { collapseLatestRegnoRows, latestRegnoByTmtIds } from "@/modules/tmt/search";

test("latest RegNo projection keeps one value, blanks missing, and exposes conflicts", () => {
  const result = collapseLatestRegnoRows([
    { tmtId: "565818", regno: "1A 124/67", changeDate: "2026-02-01" },
    { tmtId: "565818", regno: "1A 125/67", changeDate: "2026-02-01" },
    { tmtId: "565818", regno: "OLD", changeDate: "2026-01-01" },
    { tmtId: "566021", regno: "1A 200/67", changeDate: "2026-02-01" },
  ], ["565818", "566021", "736460"]);

  assert.deepEqual(result.get("565818"), { value: null, conflict: true });
  assert.deepEqual(result.get("566021"), { value: "1A 200/67", conflict: false });
  assert.deepEqual(result.get("736460"), { value: null, conflict: false });
});

test("duplicate copies of the same latest RegNo are unambiguous", () => {
  const result = collapseLatestRegnoRows([
    { tmtId: "565818", regno: "1A 124/67", changeDate: "2026-02-01" },
    { tmtId: "565818", regno: "1A 124/67", changeDate: "2026-02-01" },
  ], ["565818"]);

  assert.deepEqual(result.get("565818"), { value: "1A 124/67", conflict: false });
});

test("blank latest RegNo rows remain blank and do not create a false conflict", () => {
  const result = collapseLatestRegnoRows([
    { tmtId: "565818", regno: "", changeDate: "2026-02-01" },
    { tmtId: "566021", regno: "   ", changeDate: "2026-02-01" },
    { tmtId: "566021", regno: "1A 200/67", changeDate: "2026-02-01" },
  ], ["565818", "566021"]);

  assert.deepEqual(result.get("565818"), { value: null, conflict: false });
  assert.deepEqual(result.get("566021"), { value: "1A 200/67", conflict: false });
});

test("RegNo enrichment uses one bounded query for a result batch", async () => {
  let queryCount = 0;
  const pool = {
    query: async (_sql: string, parameters: unknown[]) => {
      queryCount += 1;
      assert.equal(parameters.length, 6);
      return [[{ tmt_id: "565818", regno: "1A 124/67", change_date: "2026-02-01" }], []];
    },
  } as unknown as Pool;

  const result = await latestRegnoByTmtIds(pool, ["565818", "566021", "736460"]);
  assert.equal(queryCount, 1);
  assert.deepEqual(result.get("565818"), { value: "1A 124/67", conflict: false });
});
