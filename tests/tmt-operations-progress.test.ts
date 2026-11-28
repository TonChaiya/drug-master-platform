import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { test, vi } from "vitest";

const mocked = vi.hoisted(() => ({ db: { select: vi.fn() } }));
vi.mock("@/db/client", () => ({ db: mocked.db }));

import { readTmtCheckpointProgress } from "@/modules/tmt/operations";

test("checkpoint totals and latest recorded window include rows beyond the display limit", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.function("DATE_FORMAT", (value, format) => {
    assert.equal(format, "%Y-%m-%d");
    return value;
  });
  sqlite.exec(`CREATE TABLE tmt_sync_checkpoints (
    run_id TEXT, endpoint TEXT, window_begin TEXT, window_end TEXT, status TEXT,
    received_rows INT, written_rows INT, attempt_count INT, error_code TEXT, started_at TEXT, finished_at TEXT
  )`);
  const insert = sqlite.prepare("INSERT INTO tmt_sync_checkpoints VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (let i = 0; i < 140; i += 1) {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const status = i === 130 ? "failed" : i < 129 ? "succeeded" : "pending";
    const terminal = i === 130 || i < 129;
    insert.run("run", i === 130 ? "atc" : "tpu", day, day, status, i < 129 ? 2 : 0, i < 129 ? 1 : 0, terminal ? 1 : 0,
      i === 130 ? "TMT_HTTP_503" : null, null, terminal ? day + " 01:00:00" : null);
  }
  insert.run("other-run", "sub", "2020-01-01", "2020-01-01", "succeeded", 999, 999, 1, null, null, "2027-01-01 00:00:00");
  const sqlDb = drizzle(async (sql, args: Array<string | number>) => {
    assert.match(sql, /^select\b/i);
    const select = sqlite.prepare(sql);
    select.setReturnArrays(true);
    return { rows: select.all(...args) };
  });
  mocked.db.select.mockImplementation(sqlDb.select.bind(sqlDb));
  try {
    const result = await readTmtCheckpointProgress("run");
    assert.equal(result.checkpoints.length, 100);
    assert.equal(result.progress?.total, 140);
    assert.equal(result.progress?.succeeded, 129);
    assert.equal(result.progress?.failed, 1);
    assert.equal(result.progress?.receivedRows, 258);
    assert.equal(result.progress?.writtenRows, 129);
    assert.equal(result.progress?.windowBegin, "2026-01-01");
    assert.equal(result.progress?.windowEnd, "2026-05-20");
    assert.equal(result.progress?.latestRecorded?.endpoint, "atc");
    assert.equal(result.progress?.latestRecorded?.errorCode, "TMT_HTTP_503");
    assert.deepEqual(await readTmtCheckpointProgress("missing"), { checkpoints: [], progress: null });
  } finally {
    sqlite.close();
    mocked.db.select.mockReset();
  }
});
