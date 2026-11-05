import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { test } from "vitest";
import * as tmt from "@/db/schema/tmt";
import * as ttmt from "@/db/schema/ttmt";
import { drugMappings } from "@/db/schema/mappings";

const tmtSourceTables = [
  tmt.tmtSubs,
  tmt.tmtVtm,
  tmt.tmtGp,
  tmt.tmtGpu,
  tmt.tmtGpp,
  tmt.tmtTp,
  tmt.tmtTpu,
  tmt.tmtTpp,
  tmt.tmtNlem,
  tmt.tmtAtc,
  tmt.tmtRegno,
  tmt.tmtMastertmt,
  tmt.tmtConcept,
  tmt.tmtRelationship,
  tmt.tmtVersion,
] as const;

test("v2 source tables use the exact owner-approved names", () => {
  assert.deepEqual(
    tmtSourceTables.map(getTableName),
    [
      "tmt_subs",
      "tmt_vtm",
      "tmt_gp",
      "tmt_gpu",
      "tmt_gpp",
      "tmt_tp",
      "tmt_tpu",
      "tmt_tpp",
      "tmt_nlem",
      "tmt_atc",
      "tmt_regno",
      "tmt_mastertmt",
      "tmt_concept",
      "tmt_relationship",
      "tmt_version",
    ],
  );
  assert.equal(getTableName(tmt.tmtSyncRuns), "tmt_sync_runs");
  assert.equal(getTableName(tmt.tmtSyncCheckpoints), "tmt_sync_checkpoints");
  assert.equal(getTableName(ttmt.ttmtImports), "ttmt_imports");
  assert.equal(getTableName(ttmt.ttmtProducts), "ttmt_products");
});

test("temporal enrichment and relationship identities preserve replay and reverse lookup", () => {
  for (const table of [tmt.tmtNlem, tmt.tmtAtc, tmt.tmtRegno]) {
    const config = getTableConfig(table);
    assert.equal(config.primaryKeys.length, 1);
    assert.deepEqual(
      config.primaryKeys[0]?.columns.map((column) => column.name),
      ["tpuid", "change_date", config.name === "tmt_nlem" ? "nlem" : config.name === "tmt_atc" ? "atc" : "regno"],
    );
  }

  const relationship = getTableConfig(tmt.tmtRelationship);
  assert.deepEqual(relationship.primaryKeys[0]?.columns.map((column) => column.name), ["concept1", "concept2"]);
  assert.ok(relationship.indexes.some((entry) => entry.config.name === "idx_tmt_relationship_reverse"));
  assert.equal(relationship.foreignKeys.length, 0);
  assert.equal(getTableConfig(tmt.tmtNlem).foreignKeys.length, 0);
  assert.equal(getTableConfig(tmt.tmtAtc).foreignKeys.length, 0);
  assert.equal(getTableConfig(tmt.tmtRegno).foreignKeys.length, 0);
});

test("TMT and TTMT identifiers live in independent namespaces", () => {
  assert.equal(getTableConfig(tmt.tmtMastertmt).columns.find((column) => column.name === "tpucode")?.primary, true);
  assert.equal(getTableConfig(ttmt.ttmtProducts).columns.find((column) => column.name === "ttmtcode")?.primary, true);
  assert.notEqual(getTableName(tmt.tmtMastertmt), getTableName(ttmt.ttmtProducts));
});

test("0014 and 0015 are additive contracts and leave legacy schema untouched", async () => {
  const [tmtSql, ttmtSql] = await Promise.all([
    readFile(new URL("../src/db/migrations/0014_tmt_data_model_v2.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/db/migrations/0015_ttmt_data_model_v2.sql", import.meta.url), "utf8"),
  ]);
  const sql = `${tmtSql}\n${ttmtSql}`;

  for (const name of tmtSourceTables.map(getTableName)) assert.match(sql, new RegExp(`CREATE TABLE ${name}\\b`));
  assert.match(sql, /CREATE TABLE tmt_sync_runs\b/);
  assert.match(sql, /CREATE TABLE tmt_sync_checkpoints\b/);
  assert.match(sql, /CREATE TABLE ttmt_imports\b/);
  assert.match(sql, /CREATE TABLE ttmt_products\b/);
  assert.doesNotMatch(sql, /^\s*(?:DROP|TRUNCATE|DELETE|ALTER)\b/im);
  assert.doesNotMatch(sql, /standard_products|standard_imports|standard_sync_runs|drug_mappings/i);
  assert.doesNotMatch(sql, /FOREIGN KEY .*tmt_(?:concept|tpu)/i);
});

test("0016 adds nullable mapping identity without rewriting legacy data", async () => {
  const sql = await readFile(new URL("../src/db/migrations/0016_mapping_v2_identity.sql", import.meta.url), "utf8");
  assert.match(sql, /^ALTER TABLE drug_mappings/m);
  assert.match(sql, /ADD COLUMN standard_source VARCHAR\(8\) NULL/i);
  assert.match(sql, /ADD COLUMN standard_level VARCHAR\(16\) NULL/i);
  assert.match(sql, /idx_mappings_facility_standard_source/);
  assert.match(sql, /idx_mappings_standard_identity/);
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  const columns = getTableConfig(drugMappings).columns.map((column) => column.name);
  assert.ok(columns.includes("standard_code"));
  assert.ok(columns.includes("standard_source"));
  assert.ok(columns.includes("standard_level"));
});
