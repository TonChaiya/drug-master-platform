import assert from "node:assert/strict";
import { test } from "vitest";
import { mappingEligibility } from "@/modules/tmt/browser";
import { tmtV2BrowserEnabled, tmtV2MappingEnabled } from "@/modules/tmt/feature";
import { TMT_LEVEL_PRESENTATION } from "@/modules/tmt/presentation";

test("TMT v2 browser is disabled unless the explicit flag equals 1", () => {
  assert.equal(tmtV2BrowserEnabled({}), false);
  assert.equal(tmtV2BrowserEnabled({ TMT_V2_BROWSER_ENABLED: "true" }), false);
  assert.equal(tmtV2BrowserEnabled({ TMT_V2_BROWSER_ENABLED: "0" }), false);
  assert.equal(tmtV2BrowserEnabled({ TMT_V2_BROWSER_ENABLED: "1" }), true);
});

test("TMT v2 mapping is separately disabled unless its explicit flag equals 1", () => {
  assert.equal(tmtV2MappingEnabled({}), false);
  assert.equal(tmtV2MappingEnabled({ TMT_V2_MAPPING_ENABLED: "true" }), false);
  assert.equal(tmtV2MappingEnabled({ TMT_V2_MAPPING_ENABLED: "1" }), true);
});

test("commercial mapping eligibility accepts only active MasterTMT TPU", () => {
  assert.deepEqual(mappingEligibility("tpu", 0), {
    eligible: true,
    reason: "พร้อมสำหรับการจับคู่แบบ commercial TPU",
  });
  assert.deepEqual(mappingEligibility("tpu", 1), {
    eligible: false,
    reason: "รายการ TPU ถูกยกเลิก",
  });
  assert.deepEqual(mappingEligibility("tpu", null), {
    eligible: false,
    reason: "ยังยืนยันสถานะรายการสำหรับการจับคู่ไม่ได้",
  });
  assert.deepEqual(mappingEligibility("gpu", null), {
    eligible: false,
    reason: "เป็นระดับ GPU กรุณาเลือกรายการ TPU ที่เกี่ยวข้อง",
  });
  assert.equal(mappingEligibility("gp", null).eligible, false);
  assert.equal(mappingEligibility("future-level", 0).eligible, false);
});

test("owner-approved level presentation is central and neutral elsewhere", () => {
  assert.match(TMT_LEVEL_PRESENTATION.gp.markerClass, /danger/);
  assert.match(TMT_LEVEL_PRESENTATION.gpu.markerClass, /success/);
  assert.match(TMT_LEVEL_PRESENTATION.tp.markerClass, /warning/);
  assert.match(TMT_LEVEL_PRESENTATION.tpu.markerClass, /info/);
  for (const level of ["subs", "vtm", "gpp", "tpp"] as const) {
    assert.match(TMT_LEVEL_PRESENTATION[level].markerClass, /slate/);
    assert.equal(TMT_LEVEL_PRESENTATION[level].label, level.toUpperCase());
  }
});
