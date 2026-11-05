import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test, vi } from "vitest";
import { TmtLevelBadge } from "@/components/tmt/tmt-level-badge";
import { loadV2SavedIdentity } from "@/components/mappings/v2-saved-identity";
import { TmtBrowser } from "@/app/(dashboard)/admin/tmt-v2/tmt-browser";

afterEach(() => vi.unstubAllGlobals());

test("level badge always exposes text while its color marker is decorative", () => {
  const gp = renderToStaticMarkup(createElement(TmtLevelBadge, { level: "gp" }));
  assert.match(gp, /GP/);
  assert.match(gp, /bg-danger/);

  const gpu = renderToStaticMarkup(createElement(TmtLevelBadge, { level: "gpu" }));
  assert.match(gpu, /GPU/);
  assert.match(gpu, /bg-success/);
  assert.match(gpu, /aria-hidden="true"/);

  const tp = renderToStaticMarkup(createElement(TmtLevelBadge, { level: "tp" }));
  assert.match(tp, /TP/);
  assert.match(tp, /bg-warning/);

  const tpu = renderToStaticMarkup(createElement(TmtLevelBadge, { level: "tpu" }));
  assert.match(tpu, /TPU/);
  assert.match(tpu, /bg-info/);

  const unknown = renderToStaticMarkup(createElement(TmtLevelBadge, { level: "future-level" }));
  assert.match(unknown, /FUTURE-LEVEL/);
  assert.match(unknown, /bg-slate/);
});

test("browser starts as a compact read-only search workspace", () => {
  const html = renderToStaticMarkup(createElement(TmtBrowser));
  assert.match(html, /ค้นหา TMT v2/);
  assert.match(html, /ระดับ/);
  assert.match(html, /สถานะ MasterTMT/);
  assert.match(html, /ความพร้อมจับคู่/);
  assert.match(html, /ดูข้อมูลเท่านั้น/);
  assert.doesNotMatch(html, /api\/v1\/mappings\/save/);
});

test("mapping v2 reloads server truth for the newly selected source drug", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    ok: true,
    mapping: { standardSource: "TTMT", standardCode: "565818", standardLevel: "product" },
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);

  assert.deepEqual(await loadV2SavedIdentity("source-drug-b"), {
    source: "TTMT",
    code: "565818",
    level: "product",
  });
  assert.equal(fetchMock.mock.calls[0]?.[0], "/api/v1/mappings/v2?sourceDrugId=source-drug-b");

  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, mapping: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  assert.equal(await loadV2SavedIdentity("source-drug-without-mapping"), null);
});
