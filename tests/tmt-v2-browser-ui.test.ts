import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { TmtLevelBadge } from "@/components/tmt/tmt-level-badge";
import { TmtBrowser } from "@/app/(dashboard)/admin/tmt-v2/tmt-browser";

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
