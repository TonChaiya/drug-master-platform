import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("normal standards page is a TMT v2 and TTMT hub without legacy sync controls", async () => {
  const page = await source("src/app/(dashboard)/standards/page.tsx");

  assert.match(page, /readTmtV2Readiness/);
  assert.match(page, /<TmtBrowser mode="advanced"/);
  assert.match(page, /TtmtSearch/);
  assert.match(page, /ttmtImports/);
  assert.doesNotMatch(page, /StandardsPanel|standardCounts|readSyncProgress/);
});

test("mapping entry and workflow navigation lead to Mapping v2", async () => {
  const [mappingPage, layout] = await Promise.all([
    source("src/app/(dashboard)/mappings/page.tsx"),
    source("src/app/(dashboard)/layout.tsx"),
  ]);

  assert.match(mappingPage, /tmtV2MappingEnabled/);
  assert.match(mappingPage, /redirect\("\/mappings\/v2"\)/);
  assert.match(layout, /href: "\/mappings\/v2"/);

  const workflow = ["/jhcis", "/standards", "/drug-catalog", "/mappings/v2", "/exports"];
  for (let index = 1; index < workflow.length; index += 1) {
    assert.ok(layout.indexOf(workflow[index - 1]!) < layout.indexOf(workflow[index]!), `${workflow[index - 1]} must precede ${workflow[index]}`);
  }
});

test("dashboard standards readiness no longer derives from legacy standard_products", async () => {
  const queries = await source("src/modules/facilities/queries.ts");
  assert.match(queries, /readTmtV2Readiness/);
  assert.match(queries, /ttmtImports/);
  assert.match(queries, /ttmtProducts/);
  assert.doesNotMatch(queries, /standardProducts/);
});

test("production workflow pages explain source-aware lifecycle and export modes", async () => {
  const [dashboard, catalog, exports, jhcis, admin] = await Promise.all([
    source("src/app/(dashboard)/dashboard/page.tsx"),
    source("src/app/(dashboard)/drug-catalog/page.tsx"),
    source("src/app/(dashboard)/exports/export-panel.tsx"),
    source("src/app/(dashboard)/jhcis/page.tsx"),
    source("src/app/(dashboard)/admin/page.tsx"),
  ]);

  assert.match(dashboard, /\/mappings\/v2/);
  assert.match(catalog, /source drug/i);
  assert.match(catalog, /TMT\/TTMT identity/i);
  assert.match(exports, /checkpoint/i);
  assert.match(exports, /TPU/);
  assert.match(jhcis, /ขั้นตอนแรก/);
  assert.match(admin, /validated_unverified/);
});

test("TTMT search remains source-specific and exposes current product fields", async () => {
  const route = await source("src/app/api/v1/mappings/v2/standards/route.ts");
  assert.match(route, /manufacturer: ttmtProducts\.manufacturer/);
  assert.match(route, /registrationNumber: ttmtProducts\.registrationNumber/);
  assert.doesNotMatch(route, /tmtRelationship|tmtConcept|tmtMastertmt/);
});
