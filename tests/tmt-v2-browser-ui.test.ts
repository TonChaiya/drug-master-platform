import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test, vi } from "vitest";
import { TmtLevelBadge } from "@/components/tmt/tmt-level-badge";
import { TmtResultCard } from "@/components/tmt/tmt-result-card";
import { TtmtResultCard } from "@/components/ttmt/ttmt-result-card";
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

test("shared TMT result card keeps the approved field order and explicit RegNo conflict", () => {
  const html = renderToStaticMarkup(createElement(TmtResultCard, {
    result: {
      level: "tpu", tmtId: "565818", name: "FSN FIRST", tradeName: "TRADE SECOND",
      manufacturer: "MAKER THIRD", registrationNumber: null, registrationConflict: true,
      status: "active", mappingEligible: true, mappingEligibilityReason: "ELIGIBLE",
    },
  }, createElement("button", { type: "button" }, "รายละเอียด")));

  const ordered = ["TPU", "565818", "FSN FIRST", "TRADE SECOND", "MAKER THIRD", "เลขทะเบียนมีหลายค่า", "ใช้งานอยู่", "ELIGIBLE", "รายละเอียด"];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(html.indexOf(ordered[index - 1]!) < html.indexOf(ordered[index]!), `${ordered[index - 1]} must precede ${ordered[index]}`);
  }
});

test("shared TMT result card leaves missing optional fields blank", () => {
  const html = renderToStaticMarkup(createElement(TmtResultCard, {
    result: {
      level: "gpu", tmtId: "764169", name: "GPU FSN", tradeName: null,
      manufacturer: null, registrationNumber: null, registrationConflict: false,
      status: "unknown", mappingEligible: false, mappingEligibilityReason: "เลือก TPU",
    },
  }));

  assert.doesNotMatch(html, /—|N\/A/i);
  assert.match(html, /ชื่อการค้า<\/span><span[^>]*><\/span>/);
  assert.match(html, /ผู้ผลิต<\/span><span[^>]*><\/span>/);
  assert.match(html, /เลขทะเบียนยา<\/span><span[^>]*><\/span>/);
});

test("TTMT result stays in its own product namespace and leaves optional fields blank", () => {
  const html = renderToStaticMarkup(createElement(TtmtResultCard, { result: {
    source: "TTMT", code: "TTMT-001", level: "product", fsn: "TTMT PRODUCT",
    activeIngredient: "ingredient", tradeName: null, manufacturer: null,
    registrationNumber: null, active: true, sourceVersion: "20261001",
  } }));

  assert.match(html, /TTMT-001/);
  assert.match(html, /TTMT PRODUCT/);
  assert.doesNotMatch(html, /GP|GPU|TPU|MasterTMT|—|N\/A/);
});

test("browser starts as a compact read-only search workspace", () => {
  const html = renderToStaticMarkup(createElement(TmtBrowser));
  assert.match(html, /ค้นหา TMT v2/);
  assert.match(html, /ระดับ/);
  assert.match(html, /สถานะ MasterTMT/);
  assert.match(html, /ความพร้อมจับคู่/);
  assert.match(html, /ดูข้อมูลเท่านั้น/);
  assert.doesNotMatch(html, /api\/v1\/mappings\/save/);
  assert.doesNotMatch(html, /ชื่อสามัญ|ชื่อการค้า|เลขทะเบียนยา|ล้างตัวกรอง/);
});

test("advanced standards browser exposes nine independent filters and a clear action", () => {
  const html = renderToStaticMarkup(createElement(TmtBrowser, { mode: "advanced" }));
  for (const label of [
    "TMT ID",
    "ชื่อยา / FSN",
    "ชื่อสามัญ",
    "ชื่อการค้า",
    "ผู้ผลิต",
    "เลขทะเบียนยา",
    "ระดับ TMT",
    "สถานะ",
    "ความพร้อมจับคู่",
  ]) assert.match(html, new RegExp(label.replace("/", "\\/")));
  assert.match(html, /ล้างตัวกรอง/);
});

test("admin browser and mapping pages label validated-unverified data as degraded", async () => {
  const [browserPage, mappingPage, mappingWorkbench] = await Promise.all([
    readFile(new URL("../src/app/(dashboard)/admin/tmt-v2/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(dashboard)/mappings/v2/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/mappings/v2-mapping-workbench.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(browserPage, /readiness\.assurance === "validated_unverified"/);
  assert.match(browserPage, /ข้อมูล TMT ผ่านการตรวจสอบแบบ degraded/);
  assert.match(mappingPage, /readiness\.assurance === "validated_unverified"/);
  assert.match(mappingPage, /กำลังใช้ข้อมูล TMT แบบ degraded/);
  assert.doesNotMatch(`${browserPage}\n${mappingPage}`, /validated-unverified[^\n]*verified succeeded/i);
  assert.doesNotMatch(`${mappingPage}\n${mappingWorkbench}`, /ทดลองใน local เท่านั้น/);
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
