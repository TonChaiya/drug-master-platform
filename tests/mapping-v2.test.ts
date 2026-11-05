import assert from "node:assert/strict";
import { test } from "vitest";
import { evaluateMappingV2Standard } from "@/modules/mappings/v2";

test("PRODUCTCAT 1 accepts only an active TMT TPU with MasterTMT", () => {
  assert.deepEqual(
    evaluateMappingV2Standard({
      source: "TMT",
      code: "565818",
      level: "tpu",
      productCat: "1",
      conceptLevel: "tpu",
      masterStatus: 0,
      exists: true,
    }),
    { eligible: true, reason: null },
  );
});

test("GPU, GP, TP, inactive, unknown, missing MasterTMT, and a level mismatch fail closed", () => {
  const base = { source: "TMT" as const, code: "764169", productCat: "1", exists: true };
  assert.match(evaluateMappingV2Standard({ ...base, level: "gpu", conceptLevel: "gpu", masterStatus: null }).reason ?? "", /GPU/);
  assert.equal(evaluateMappingV2Standard({ ...base, level: "gp", conceptLevel: "gp", masterStatus: null }).eligible, false);
  assert.equal(evaluateMappingV2Standard({ ...base, level: "tp", conceptLevel: "tp", masterStatus: null }).eligible, false);
  assert.equal(evaluateMappingV2Standard({ ...base, level: "tpu", conceptLevel: "tpu", masterStatus: 1 }).eligible, false);
  assert.equal(evaluateMappingV2Standard({ ...base, level: "tpu", conceptLevel: "tpu", masterStatus: null }).eligible, false);
  assert.equal(evaluateMappingV2Standard({ ...base, level: "tpu", conceptLevel: "gpu", masterStatus: 0 }).eligible, false);
});

test("TTMT is independent of TMT hierarchy and requires an active product", () => {
  assert.deepEqual(
    evaluateMappingV2Standard({ source: "TTMT", code: "9003806", level: "product", productCat: "3", exists: true, ttmtStatus: "active" }),
    { eligible: true, reason: null },
  );
  assert.equal(
    evaluateMappingV2Standard({ source: "TTMT", code: "9003806", level: "product", productCat: "3", exists: true, ttmtStatus: "inactive" }).eligible,
    false,
  );
  assert.equal(
    evaluateMappingV2Standard({ source: "TTMT", code: "9003806", level: "tpu", productCat: "3", exists: true, ttmtStatus: "active" }).eligible,
    false,
  );
});

test("unproven PRODUCTCAT 2 and 4 remain fail closed", () => {
  for (const productCat of ["2", "4"]) {
    assert.equal(
      evaluateMappingV2Standard({ source: "TMT", code: "565818", level: "tpu", productCat, conceptLevel: "tpu", masterStatus: 0, exists: true }).eligible,
      false,
    );
  }
});
