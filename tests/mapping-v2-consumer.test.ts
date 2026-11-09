import assert from "node:assert/strict";
import { test } from "vitest";
import { resolveMappedStandardV2 } from "@/modules/mappings/v2-consumer";

const tmt = {
  identity: { source: "TMT" as const, code: "565818", level: "tpu", productCat: "1" },
  concept: { level: "tpu", fsn: "TMT concept", sourceVersion: "20261105" },
  master: {
    activeIngredient: "ยาเอ", strength: "5 mg", dosageForm: "tablet", contentValue: "1",
    contentUnit: "tablet", dispensingUnit: "tablet", tradeName: "TRADE A", manufacturer: "ผู้ผลิตไทย",
    fsn: "ยาเอ 5 mg tablet", status: 0, sourceVersion: "20261105",
  },
  nlem: { changeDate: "2026-11-01", values: ["ED"] },
  regno: { changeDate: "2026-11-01", values: ["1A 1/2569"] },
};

test("resolves an active TMT TPU from MasterTMT with NLEM and registration enrichment", () => {
  const resolved = resolveMappedStandardV2(tmt);
  assert.equal(resolved.eligible, true);
  assert.equal(resolved.activeIngredient, "ยาเอ");
  assert.equal(resolved.tradeName, "TRADE A");
  assert.equal(resolved.exportIsed, "E");
  assert.equal(resolved.registrationNumber, "1A 1/2569");
  assert.deepEqual(resolved.warnings, []);
});

test("rejects GPU 764169 and never treats it as an exportable commercial TPU", () => {
  const resolved = resolveMappedStandardV2({
    identity: { source: "TMT", code: "764169", level: "gpu", productCat: "1" },
    concept: { level: "gpu", fsn: "GPU", sourceVersion: "20261105" }, master: null, nlem: null, regno: null,
  });
  assert.equal(resolved.eligible, false);
  assert.match(resolved.reason ?? "", /GPU/);
});

test("keeps latest-date NLEM and RegNo conflicts explicit without arbitrary selection", () => {
  const resolved = resolveMappedStandardV2({
    ...tmt,
    nlem: { changeDate: "2026-11-01", values: ["ED", "NED"] },
    regno: { changeDate: "2026-11-01", values: ["A", "B"] },
  });
  assert.equal(resolved.exportIsed, null);
  assert.equal(resolved.registrationNumber, null);
  assert.ok(resolved.warnings.some((warning) => warning.includes("NLEM")));
  assert.ok(resolved.warnings.some((warning) => warning.includes("ทะเบียน")));
  assert.equal(resolved.eligible, true, "neither ambiguity is a required export field in the locked contract");
});

test("unknown NLEM keeps raw data, exports blank ISED, and warns", () => {
  const resolved = resolveMappedStandardV2({ ...tmt, nlem: { changeDate: "2026-11-01", values: ["UNKNOWN"] } });
  assert.equal(resolved.rawNlem, "UNKNOWN");
  assert.equal(resolved.exportIsed, null);
  assert.ok(resolved.warnings.some((warning) => warning.includes("UNKNOWN")));
});

test("resolves TTMT directly and keeps the same numeric code in a separate namespace", () => {
  const resolved = resolveMappedStandardV2({
    identity: { source: "TTMT", code: "565818", level: "product", productCat: "3" },
    product: {
      activeIngredient: "TTMT generic", strength: "10 mg", dosageForm: "capsule", contentValue: "10",
      contentUnit: "capsule", dispensingUnit: "box", tradeName: "TTMT TRADE", manufacturer: "TTMT maker",
      fsn: "TTMT FSN", status: "active", nlem: "NED", registrationNumber: "TTMT-REG",
      sourceVersion: "ttmt-1", importStatus: "succeeded",
    },
  });
  assert.equal(resolved.source, "TTMT");
  assert.equal(resolved.code, "565818");
  assert.equal(resolved.tradeName, "TTMT TRADE");
  assert.equal(resolved.exportIsed, "N");
  assert.equal(resolved.eligible, true);
});

test("inactive TMT and inactive TTMT fail closed", () => {
  assert.equal(resolveMappedStandardV2({ ...tmt, master: { ...tmt.master, status: 1 } }).eligible, false);
  assert.equal(resolveMappedStandardV2({
    identity: { source: "TTMT", code: "565818", level: "product", productCat: "3" },
    product: {
      activeIngredient: null, strength: null, dosageForm: null, contentValue: null, contentUnit: null,
      dispensingUnit: null, tradeName: null, manufacturer: null, fsn: null, status: "inactive", nlem: null,
      registrationNumber: null, sourceVersion: "ttmt-1", importStatus: "succeeded",
    },
  }).eligible, false);
});
