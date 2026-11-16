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
    },
  }));
  assert.match(html, /เริ่มและดำเนินการต่อผ่าน CLI ที่มี guard/);
  assert.match(html, /ยังไม่มีประวัติ TMT sync/);
  assert.doesNotMatch(html, /<button[^>]*>\s*(?:เริ่มซิงก์|เริ่ม|ดำเนินการต่อ)\s*<\/button>/);
});

test("Admin TMT panel makes running progress and guarded resume requirements explicit", () => {
  const html = renderToStaticMarkup(createElement(TmtOperationsPanel, {
    initial: {
      readiness: { ready: false, assurance: null, reason: "RUN_NOT_SUCCEEDED", run: null },
      latestRun: {
        id: "run-1", tmtVersion: "20261116", mode: "resume", status: "running", receivedRows: 80, writtenRows: 70,
        warningsCount: 0, errorCode: null, startedAt: "2026-11-16T00:00:00.000Z", finishedAt: null,
      },
      runs: [],
      checkpoints: [
        { endpoint: "tpu", windowBegin: "2026-01-01", windowEnd: "2026-01-31", status: "succeeded", receivedRows: 40, writtenRows: 40, attemptCount: 1, errorCode: null, startedAt: null, finishedAt: null },
        { endpoint: "mastertmt", windowBegin: "2026-01-01", windowEnd: "2026-01-31", status: "pending", receivedRows: 0, writtenRows: 0, attemptCount: 0, errorCode: null, startedAt: null, finishedAt: null },
      ],
    },
  }));

  assert.match(html, /กำลังซิงก์อยู่/);
  assert.match(html, /Checkpoint สำเร็จ 1 \/ 2/);
  assert.match(html, /รีเฟรชสถานะทุก 15 วินาที/);
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
