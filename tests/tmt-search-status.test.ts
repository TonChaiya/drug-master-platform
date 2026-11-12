import assert from "node:assert/strict";
import type { Pool } from "mysql2/promise";
import { test, vi } from "vitest";
import { searchTmt, type TmtSearchFilters } from "@/modules/tmt/search";

async function querySql(filters: TmtSearchFilters): Promise<string> {
  const query = vi.fn().mockResolvedValue([[]]);
  await searchTmt({ query } as unknown as Pool, filters);
  return String(query.mock.calls[0]?.[0]);
}

test("active status keeps non-TPU concepts while limiting TPU to active MasterTMT", async () => {
  const sql = await querySql({ tmtId: "764169", status: "active" });
  assert.match(sql, /\(c\.level_name<>'tpu' OR m\.status=0\)/);
  assert.doesNotMatch(sql, /c\.level_name='tpu' AND m\.status=0/);
});

test("mapping eligibility remains an independent active TPU-only filter", async () => {
  const sql = await querySql({ fsn: "lidocaine", status: "active", mappingEligible: true });
  assert.match(sql, /\(c\.level_name<>'tpu' OR m\.status=0\)/);
  assert.match(sql, /c\.level_name='tpu' AND m\.status=0/);
});

test("cancelled and unknown status conditions retain their established semantics", async () => {
  const cancelled = await querySql({ fsn: "lidocaine", status: "cancelled" });
  assert.match(cancelled, /c\.level_name='tpu' AND m\.status=1/);

  const unknown = await querySql({ fsn: "lidocaine", status: "unknown" });
  assert.match(unknown, /c\.level_name<>'tpu' OR m\.status IS NULL OR m\.status NOT IN \(0,1\)/);
});
