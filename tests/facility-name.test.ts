import assert from "node:assert/strict";
import { test } from "vitest";
import { isValidOfficeId, normalizeFacilityName } from "@/lib/validation/facility";

/**
 * One facility has several accounts, so everyone after the first has to name a
 * facility that already exists. The typed name is a confirmation that the
 * 5-digit code is the right one — the stored name is the source of truth — so
 * the comparison must forgive spacing without forgiving a wrong code.
 */

test("treats spacing and case differences as the same facility", () => {
  const stored = "รพ.สต.ทดสอบ เอ";
  for (const typed of ["รพ.สต. ทดสอบ เอ", " รพ.สต.ทดสอบ  เอ ", "รพ.สต.ทดสอบเอ"]) {
    assert.equal(normalizeFacilityName(typed), normalizeFacilityName(stored), `should match: ${typed}`);
  }
});

test("still refuses a name that is simply a different place", () => {
  assert.notEqual(normalizeFacilityName("โรงพยาบาลอื่น"), normalizeFacilityName("รพ.สต.ทดสอบ เอ"));
});

test("keeps the office-id rule the agent enforces from JHCIS", () => {
  assert.equal(isValidOfficeId("05957"), true);
  assert.equal(isValidOfficeId("0000x"), false, "the JHCIS placeholder must never pass");
  assert.equal(isValidOfficeId("00001"), false, "0000-prefixed codes are placeholders");
  assert.equal(isValidOfficeId("5957"), false);
  assert.equal(isValidOfficeId("059570"), false);
});
