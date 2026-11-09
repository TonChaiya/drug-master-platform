import assert from "node:assert/strict";
import { test } from "vitest";
import { exportSnapshotHash, isExportCandidate, type ExportCandidateState } from "@/modules/exports/delta";
import { exportRowFromV2Standard } from "@/modules/exports/rows-v2";
import { resolveMappedStandardV2 } from "@/modules/mappings/v2-consumer";

const base = {
  drugcode: "00123",
  sell: "12.50",
  productCat: "1",
  specPrep: null,
  dfscode: null,
  unitPrice: null,
  distributor: null,
  ndc24: "000000000000000000000001",
  packsize: null,
  packPrice: null,
  updateFlag: "E",
  dateChange: "2026-11-05",
  dateUpdate: "2026-11-05",
  dateEffective: "2026-11-05",
};

test("exports selected TPU 565818 and never the catalog GPU 764169", () => {
  const standard = resolveMappedStandardV2({
    identity: { source: "TMT", code: "565818", level: "tpu", productCat: "1" },
    concept: { level: "tpu", fsn: "concept", sourceVersion: "v1" },
    master: {
      activeIngredient: "ยาทดสอบ", strength: "5 mg", dosageForm: "tablet", contentValue: "1",
      contentUnit: "tablet", dispensingUnit: "box", tradeName: "TEST", manufacturer: "ผู้ผลิต",
      fsn: "fsn", status: 0, sourceVersion: "v1",
    },
    nlem: { changeDate: "2026-11-01", values: ["ED*"] },
    regno: null,
  });
  const row = exportRowFromV2Standard(base, standard);
  assert.equal(row.tmtid, "565818");
  assert.notEqual(row.tmtid, "764169");
  assert.equal(row.ised, "E*");
  assert.equal(row.hospdrugcode, "00123");
  assert.equal(row.ndc24, "000000000000000000000001");
  assert.equal(row.genericname, "ยาทดสอบ");
  assert.equal(row.manufacturer, "ผู้ผลิต");
});

test("TTMT 565818 resolves only TTMT fields despite sharing a numeric code with TMT", () => {
  const standard = resolveMappedStandardV2({
    identity: { source: "TTMT", code: "565818", level: "product", productCat: "3" },
    product: {
      activeIngredient: "TTMT generic", strength: "20 mg", dosageForm: "capsule", contentValue: null,
      contentUnit: null, dispensingUnit: "capsule", tradeName: "TTMT trade", manufacturer: "TTMT maker",
      fsn: "TTMT fsn", status: "active", nlem: "NED", registrationNumber: null,
      sourceVersion: "ttmt-v1", importStatus: "succeeded",
    },
  });
  const row = exportRowFromV2Standard({ ...base, productCat: "3" }, standard);
  assert.equal(row.tmtid, "565818");
  assert.equal(row.genericname, "TTMT generic");
  assert.equal(row.tradename, "TTMT trade");
  assert.equal(row.ised, "N");
});

test("v2 export readiness excludes inactive standards from full and delta", () => {
  const candidate: ExportCandidateState = {
    facilityId: "facility-a", mappingId: "mapping-a", mappingSource: "manual",
    mappingUpdatedAt: new Date("2026-11-05T00:00:00Z"), checkpointExportId: null,
    status: "mapped", standardValid: false, standardSource: "TMT", standardCode: "565818", standardLevel: "tpu",
  };
  assert.equal(isExportCandidate(candidate, null, "all-mapped"), false);
  assert.equal(isExportCandidate(candidate, null, "manual-changes"), false);
});

test("preview snapshot includes the source-specific mapping identity", () => {
  const candidate = {
    facilityId: "facility-a", mappingId: "mapping-a", mappingSource: "manual",
    mappingUpdatedAt: new Date("2026-11-05T00:00:00Z"), checkpointExportId: null,
    status: "mapped" as const, standardValid: true, standardSource: "TMT", standardCode: "565818",
    standardLevel: "tpu", row: { tmtid: "565818" },
  };
  const hash = exportSnapshotHash("facility-a", "all-mapped", [candidate]);
  assert.notEqual(exportSnapshotHash("facility-a", "all-mapped", [{ ...candidate, standardSource: "TTMT", standardLevel: "product" }]), hash);
});
