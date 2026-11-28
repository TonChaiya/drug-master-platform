import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

import { TmtOperationsPanel } from "@/app/(dashboard)/admin/tmt-operations-panel";
import { TtmtImportPanel } from "@/app/(dashboard)/admin/ttmt-import-panel";

test("Admin TMT panel reports CLI-only control and current run/checkpoint status", () => {
  const html = renderToStaticMarkup(createElement(TmtOperationsPanel, {
    initial: {
      readiness: { ready: false, assurance: null, reason: "RUN_MISSING", run: null },
      latestRun: null,
      runs: [],
      checkpoints: [],
      progress: null,
    },
  }));
  assert.match(html, /เริ่มและทำต่อผ่านเว็บยังไม่เปิดใช้/);
  assert.match(html, /Full-unverified ทำต่อจากจุดที่ค้างไม่ได้/);
  assert.match(html, /ยังไม่มีประวัติ TMT sync/);
  assert.doesNotMatch(html, /<button[^>]*>\s*(?:เริ่มซิงก์|เริ่ม|ดำเนินการต่อ)\s*<\/button>/);
});

test("Admin TMT panel renders all-checkpoint progress, not the bounded display rows", () => {
  const recorded = { endpoint: "tpu", windowBegin: "2026-01-01", windowEnd: "2026-01-31", status: "succeeded", receivedRows: 40, writtenRows: 40, attemptCount: 1, errorCode: null, startedAt: null, finishedAt: null };
  const html = renderToStaticMarkup(createElement(TmtOperationsPanel, {
    initial: {
      readiness: { ready: false, assurance: null, reason: "RUN_NOT_SUCCEEDED", run: null },
      latestRun: {
        id: "run-1", tmtVersion: "20261116", mode: "full", status: "running", receivedRows: 0, writtenRows: 0,
        warningsCount: 0, errorCode: null, startedAt: "2026-11-16T00:00:00.000Z", finishedAt: null,
      },
      runs: [],
      checkpoints: [
        recorded,
        { endpoint: "mastertmt", windowBegin: "2026-01-01", windowEnd: "2026-01-31", status: "pending", receivedRows: 0, writtenRows: 0, attemptCount: 0, errorCode: null, startedAt: null, finishedAt: null },
      ],
      progress: { total: 220, succeeded: 130, failed: 2, receivedRows: 540, writtenRows: 530, windowBegin: "2013-01-01", windowEnd: "2026-01-31", latestRecorded: recorded },
    },
  }));

  assert.match(html, /กำลังทำงาน/);
  assert.match(html, /รายงานผลแล้ว 132 \/ 220/);
  assert.match(html, /aria-valuenow="60"/);
  assert.match(html, /540 \/ 530/);
  assert.match(html, /Checkpoint ที่รายงานล่าสุด tpu/);
  assert.match(html, /รีเฟรชสถานะทุก 15 วินาที/);
});

test.each([
  ["queued", null, "อยู่ในคิว"],
  ["failed", "TMT_HTTP_503", "ตรวจว่า TMT API กลับมาให้บริการ"],
  ["stale", "TMT_VERSION_DRIFT", "หยุดการทำต่อจาก checkpoint"],
  ["succeeded", null, "สำเร็จ"],
  ["unverified", "TMT_VERSION_UNVERIFIED", "ยังไม่ยืนยันเวอร์ชัน"],
] as const)("Admin TMT panel displays %s and any actionable status", (status, errorCode, text) => {
  const run = { id: "run", mode: "full", status, errorCode, tmtVersion: "20261116", startedAt: "2026-11-16T00:00:00.000Z", finishedAt: null, receivedRows: 0, writtenRows: 0, warningsCount: 1 };
  const html = renderToStaticMarkup(createElement(TmtOperationsPanel, { initial: {
    readiness: { ready: false, assurance: null, reason: "RUN_NOT_SUCCEEDED", run: null }, latestRun: run, runs: [run], checkpoints: [], progress: null,
  } }));
  assert.ok(html.includes(text));
  if (errorCode) assert.ok(html.includes(errorCode));
  assert.doesNotMatch(html, /<button[^>]*>\s*(?:เริ่มซิงก์|ดำเนินการต่อ)\s*<\/button>/);
});

test("candidate dashboard shows guarded actions and the leased endpoint separately from historical monitoring", () => {
  const html = renderToStaticMarkup(createElement(TmtOperationsPanel, { initial: {
    readiness: { ready: false, assurance: null, reason: "RUN_MISSING", run: null }, latestRun: null, runs: [], checkpoints: [], progress: null,
    candidateOperations: {
      controlsEnabled: true, pointer: { datasetId: "accepted", generation: 2, coverageThrough: "2026-11-28", assurance: "validated_unverified" },
      accepted: [{ id: "old", assurance: "validated_unverified", version: "20261127" }],
      jobs: [
        { id: "a", status: "running", mode: "incremental", version: "v1", completed: 145, total: 200,
          received: 123, written: 120, warnings: 0, errorCode: null, resumable: false, promotable: false,
          processing: { endpoint: "tpu", window: { begindate: "2026-11-01", enddate: "2026-11-28" } } },
        { id: "b", status: "validated", mode: "full", version: "v1", completed: 200, total: 200,
          received: 400, written: 400, warnings: 0, errorCode: null, resumable: false, promotable: true, processing: null },
        { id: "c", status: "failed", mode: "incremental", version: "v1", completed: 20, total: 30,
          received: 30, written: 10, warnings: 1, errorCode: "TMT_HTTP_503", resumable: true, promotable: false, processing: null },
      ],
    },
  } }));
  assert.match(html, /เริ่มซิงก์/);
  assert.match(html, /ทำต่อจากจุดที่ค้าง/);
  assert.match(html, /อนุมัติและเปิดใช้/);
  assert.match(html, /ย้อนกลับชุดนี้/);
  assert.match(html, /Checkpoint 145 \/ 200/);
  assert.match(html, /กำลังทำ tpu/);
  assert.match(html, /name="begin"/);
  assert.match(html, /name="end"/);
});

test("Admin TTMT history renders both succeeded and failed v2 imports", () => {
  const html = renderToStaticMarkup(createElement(TtmtImportPanel, {
    imports: [
      { id: "success", version: "20261001", filename: "good.xls", contentHash: "a".repeat(64), rowCount: 9654, status: "succeeded", startedAt: "2026-11-01T00:00:00.000Z", completedAt: "2026-11-01T01:00:00.000Z" },
      { id: "failed", version: "20261101", filename: "bad.xls", contentHash: "b".repeat(64), rowCount: 0, status: "failed", startedAt: "2026-11-02T00:00:00.000Z", completedAt: "2026-11-02T01:00:00.000Z" },
    ],
  }));
  assert.match(html, /20261001/);
  assert.match(html, /20261101/);
  assert.match(html, /สำเร็จ/);
  assert.match(html, /ล้มเหลว/);
  assert.doesNotMatch(html, /standard_products/);
});
