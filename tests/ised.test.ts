import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeNlem } from "@/modules/mappings/ised";
import { standardStatusFromApi } from "@/modules/standards/normalize";

/**
 * ISED is written straight into the DrugCat export, so a wrong mapping is a
 * wrong submission rather than a visible failure. The API sends ED / ED* / NED
 * today; the already-mapped forms are accepted because the PHP system accepted
 * them and a normalised feed would otherwise blank every ISED.
 */

test("maps the values the TMT API actually sends", () => {
  assert.equal(normalizeNlem("ED").exportValue, "E");
  assert.equal(normalizeNlem("ED*").exportValue, "E*");
  assert.equal(normalizeNlem("NED").exportValue, "N");
});

test("accepts the already-mapped forms unchanged", () => {
  for (const value of ["E", "E*", "N"]) {
    assert.equal(normalizeNlem(value).exportValue, value);
    assert.equal(normalizeNlem(value).warning, null);
  }
});

test("is case- and space-insensitive", () => {
  assert.equal(normalizeNlem("  ed  ").exportValue, "E");
  assert.equal(normalizeNlem("ned").exportValue, "N");
});

test("leaves ISED empty and warns on a value it does not recognise", () => {
  const result = normalizeNlem("SOMETHING");
  assert.equal(result.exportValue, null, "an unknown code must not be guessed at");
  assert.equal(result.raw, "SOMETHING", "the raw value is kept so it can be investigated");
  assert.match(result.warning ?? "", /SOMETHING/);
});

test("treats no value as no value, without a warning", () => {
  for (const value of [null, undefined, "", "   "]) {
    const result = normalizeNlem(value);
    assert.equal(result.exportValue, null);
    assert.equal(result.raw, null);
    assert.equal(result.warning, null);
  }
});

test("reads MasterTMT status per the manual: 0 is active", () => {
  // tmtapi_manual.pdf table 15: status 0 = ใช้งาน, 1 = ยกเลิก.
  assert.equal(standardStatusFromApi(0), "active");
  assert.equal(standardStatusFromApi("0"), "active");
  assert.equal(standardStatusFromApi(1), "inactive");
  assert.equal(standardStatusFromApi(null), "inactive", "an absent status must not read as active");
});
