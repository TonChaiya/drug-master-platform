import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { searchTtmtStandards, type TtmtSearchFilters } from "@/modules/standards/ttmt-search";
import type { ActiveStandardRelease } from "@/modules/standards/active-release";

const release: ActiveStandardRelease = {
  releaseId: "00000000-0000-4000-8000-000000000001",
  tmtDatasetId: "00000000-0000-4000-8000-000000000002",
  ttmtDatasetId: "00000000-0000-4000-8000-000000000003",
};

async function captured(filters: TtmtSearchFilters, activeRelease?: ActiveStandardRelease) {
  const query = vi.fn().mockResolvedValue([[]]);
  await searchTtmtStandards({ query } as never, filters, activeRelease);
  return { sql: String(query.mock.calls[0]?.[0]), parameters: query.mock.calls[0]?.[1] as unknown[] };
}

test("TTMT search keeps every independent filter in its own predicate", async () => {
  const cases: Array<[keyof TtmtSearchFilters, string]> = [
    ["code", "p.ttmtcode LIKE ?"],
    ["tradeName", "p.normalized_trade LIKE ?"],
    ["genericName", "p.normalized_generic LIKE ?"],
    ["manufacturer", "p.normalized_manufacturer LIKE ?"],
    ["registrationNumber", "p.normalized_regno LIKE ?"],
  ];
  for (const [key, predicate] of cases) {
    const { sql, parameters } = await captured({ [key]: "Example" });
    assert.match(sql, new RegExp(predicate.replace(/[?.]/g, "\\$&")));
    assert.equal(parameters.length, 2);
  }
});

test("combined TTMT filters are ANDed and stay inside the active dataset", async () => {
  const { sql, parameters } = await captured({
    code: "TT", tradeName: "Trade", genericName: "Generic", manufacturer: "Maker", registrationNumber: "1A 23",
  }, release);
  assert.match(sql, /FROM ttmt_dataset_products p/);
  assert.match(sql, /p\.dataset_id=\? AND p\.ttmtcode LIKE \? AND p\.normalized_trade LIKE \? AND p\.normalized_generic LIKE \? AND p\.normalized_manufacturer LIKE \? AND p\.normalized_regno LIKE \?/);
  assert.doesNotMatch(sql, /ttmt_products p INNER JOIN| OR /);
  assert.equal(parameters[0], release.ttmtDatasetId);
  assert.equal(parameters.at(-1), 30);
});

test("live TTMT search preserves succeeded-import isolation", async () => {
  const { sql } = await captured({ genericName: "Generic" });
  assert.match(sql, /ttmt_products p INNER JOIN ttmt_imports i ON i\.id=p\.source_import_id AND i\.status='succeeded'/);
  assert.doesNotMatch(sql, /ttmt_dataset_products/);
});

test("existing combined q search remains available for the Standards Hub", async () => {
  const { sql, parameters } = await captured({ query: "drug" });
  assert.match(sql, /p\.ttmtcode LIKE \? OR p\.normalized_generic LIKE \? OR p\.normalized_trade LIKE \? OR p\.normalized_manufacturer LIKE \? OR p\.normalized_regno LIKE \?/);
  assert.equal(parameters.length, 6);
});
