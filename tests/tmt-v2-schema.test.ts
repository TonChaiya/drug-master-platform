import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { test } from "vitest";
import * as tmt from "@/db/schema/tmt";
import * as ttmt from "@/db/schema/ttmt";
import { drugMappings } from "@/db/schema/mappings";

function tableBody(sql: string, table: string): string {
  const match = sql.match(new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(match?.[1], `Missing explicit CREATE TABLE ${table}`);
  return match[1];
}

function definitions(body: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "(") depth += 1;
    else if (body[index] === ")") depth -= 1;
    else if (body[index] === "," && depth === 0) {
      result.push(body.slice(start, index).trim().replace(/\s+/g, " "));
      start = index + 1;
    }
  }
  result.push(body.slice(start).trim().replace(/\s+/g, " "));
  return result.filter(Boolean);
}

function columnDefinitions(body: string): Map<string, string> {
  return new Map(definitions(body)
    .filter((definition) => !/^(?:PRIMARY|UNIQUE|KEY|CONSTRAINT)\b/i.test(definition))
    .map((definition) => {
      const [name] = definition.split(" ");
      return [name!, definition.replace(/\s+PRIMARY KEY\b/i, "")] as const;
    }));
}

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
  assert.equal(getTableName(tmt.tmtRunValidations), "tmt_run_validations");
  assert.equal(getTableName(ttmt.ttmtImports), "ttmt_imports");
  assert.equal(getTableName(ttmt.ttmtProducts), "ttmt_products");
});

test("validated-unverified evidence has one row per run with cascade invalidation", async () => {
  const config = getTableConfig(tmt.tmtRunValidations);
  assert.equal(config.columns.find((column) => column.name === "run_id")?.primary, true);
  assert.deepEqual(config.foreignKeys.map((foreignKey) => foreignKey.onDelete), ["cascade", undefined]);
  assert.equal(config.indexes.length, 0);

  const sql = await readFile(new URL("../src/db/migrations/0017_tmt_run_validations.sql", import.meta.url), "utf8");
  for (const column of [
    "run_id", "policy_version", "status", "validated_at", "required_checkpoint_count",
    "required_succeeded_count", "optional_failure_count", "blocking_invariant_count",
    "invariant_evidence", "gpu_764169_passed", "ttmt_import_id", "ttmt_content_hash",
    "ttmt_row_count", "evidence_sha256",
  ]) assert.match(sql, new RegExp(`\\b${column}\\b`, "i"));
  assert.match(sql, /PRIMARY KEY \(run_id\)/i);
  assert.match(sql, /FOREIGN KEY \(run_id\) REFERENCES tmt_sync_runs\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /FOREIGN KEY \(ttmt_import_id\) REFERENCES ttmt_imports\(id\)/i);
  assert.doesNotMatch(sql, /^\s*(?:DROP|DELETE|TRUNCATE|UPDATE)\b/im);
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
  const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);
  assert.equal(statements.length, 3);
  assert.match(statements[0] ?? "", /^ALTER TABLE drug_mappings\s+ADD COLUMN standard_source VARCHAR\(8\) NULL AFTER standard_code$/i);
  assert.match(statements[1] ?? "", /^ALTER TABLE drug_mappings\s+ADD COLUMN standard_level VARCHAR\(16\) NULL AFTER standard_source$/i);
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

test("0018 explicit shadow tables preserve the source schema with dataset-scoped identities", async () => {
  const [sourceTmt, sourceTtmt, migration] = await Promise.all([
    readFile(new URL("../src/db/migrations/0014_tmt_data_model_v2.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/db/migrations/0015_ttmt_data_model_v2.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/db/migrations/0018_versioned_standard_dataset_foundation.sql", import.meta.url), "utf8"),
  ]);
  const contracts = [
    ["tmt_subs", "tmt_dataset_subs", ["subsid"], "idx_tmt_dataset_subs_lookup", "fk_tmt_dataset_subs_dataset"],
    ["tmt_vtm", "tmt_dataset_vtm", ["vtmid"], "idx_tmt_dataset_vtm_lookup", "fk_tmt_dataset_vtm_dataset"],
    ["tmt_gp", "tmt_dataset_gp", ["gpid"], "idx_tmt_dataset_gp_lookup", "fk_tmt_dataset_gp_dataset"],
    ["tmt_gpu", "tmt_dataset_gpu", ["gpuid"], "idx_tmt_dataset_gpu_lookup", "fk_tmt_dataset_gpu_dataset"],
    ["tmt_gpp", "tmt_dataset_gpp", ["gppid"], "idx_tmt_dataset_gpp_lookup", "fk_tmt_dataset_gpp_dataset"],
    ["tmt_tp", "tmt_dataset_tp", ["tpid"], "idx_tmt_dataset_tp_lookup", "fk_tmt_dataset_tp_dataset"],
    ["tmt_tpu", "tmt_dataset_tpu", ["tpuid"], "idx_tmt_dataset_tpu_lookup", "fk_tmt_dataset_tpu_dataset"],
    ["tmt_tpp", "tmt_dataset_tpp", ["tppid"], "idx_tmt_dataset_tpp_lookup", "fk_tmt_dataset_tpp_dataset"],
    ["tmt_nlem", "tmt_dataset_nlem", ["tpuid", "change_date", "nlem"], "idx_tmt_dataset_nlem_lookup", "fk_tmt_dataset_nlem_dataset"],
    ["tmt_atc", "tmt_dataset_atc", ["tpuid", "change_date", "atc"], "idx_tmt_dataset_atc_lookup", "fk_tmt_dataset_atc_dataset"],
    ["tmt_regno", "tmt_dataset_regno", ["tpuid", "change_date", "regno"], "idx_tmt_dataset_regno_lookup", "fk_tmt_dataset_regno_dataset"],
    ["tmt_mastertmt", "tmt_dataset_mastertmt", ["tpucode"], "idx_tmt_dataset_master_lookup", "fk_tmt_dataset_master_dataset"],
    ["tmt_concept", "tmt_dataset_concepts", ["tmtid"], "idx_tmt_dataset_concept_lookup", "fk_tmt_dataset_concepts_dataset"],
    ["tmt_relationship", "tmt_dataset_relationships", ["concept1", "concept2"], "idx_tmt_dataset_relationship_reverse", "fk_tmt_dataset_relationships_dataset"],
    ["ttmt_products", "ttmt_dataset_products", ["ttmtcode"], "idx_ttmt_dataset_product_lookup", "fk_ttmt_dataset_products_dataset"],
  ] as const;
  const shadowSection = migration.slice(migration.indexOf("CREATE TABLE tmt_dataset_subs"));
  assert.doesNotMatch(shadowSection, /CREATE TABLE\s+\w+\s+LIKE\b/i);
  assert.doesNotMatch(shadowSection, /DROP PRIMARY KEY/i);
  assert.equal((shadowSection.match(/CREATE TABLE\s+(?:tmt|ttmt)_dataset_/g) ?? []).length, 15);

  for (const [source, target, sourceKey, lookupIndex, datasetForeignKey] of contracts) {
    const sourceSql = source === "ttmt_products" ? sourceTtmt : sourceTmt;
    const sourceBody = tableBody(sourceSql, source);
    const targetBody = tableBody(migration, target);
    const sourceColumns = columnDefinitions(sourceBody);
    const targetColumns = columnDefinitions(targetBody);
    assert.deepEqual([...targetColumns.keys()], ["dataset_id", ...sourceColumns.keys()], `${target} column order`);
    assert.equal(targetColumns.get("dataset_id"), "dataset_id CHAR(36) NOT NULL", `${target} dataset identity`);
    for (const [name, definition] of sourceColumns) assert.equal(targetColumns.get(name), definition, `${target}.${name}`);
    for (const sourceIndex of definitions(sourceBody).filter((definition) => /^KEY\b/i.test(definition))) {
      assert.ok(definitions(targetBody).includes(sourceIndex), `${target} preserves ${sourceIndex}`);
    }
    assert.ok(definitions(targetBody).includes(`PRIMARY KEY (dataset_id,${sourceKey.join(",")})`), `${target} composite primary key`);
    assert.ok(definitions(targetBody).some((definition) => definition.startsWith(`KEY ${lookupIndex} `)), `${target} dataset lookup index`);
    assert.ok(definitions(targetBody).includes(`CONSTRAINT ${datasetForeignKey} FOREIGN KEY (dataset_id) REFERENCES standard_datasets(id)`), `${target} dataset FK`);
  }

  const metadataPrefix = migration.slice(0, migration.indexOf("CREATE TABLE tmt_dataset_subs"));
  assert.equal(createHash("sha256").update(metadataPrefix).digest("hex"), "308ad199b9651149ff4d3f09ecd3e3d5834fa64b8fa20451617a734d300fddf1");
});

test("0018 compatibility rewrite has an explicit journal hash transition and remains fail closed", async () => {
  const [migration, runner] = await Promise.all([
    readFile(new URL("../src/db/migrations/0018_versioned_standard_dataset_foundation.sql", import.meta.url), "utf8"),
    readFile(new URL("../scripts/migrate.mjs", import.meta.url), "utf8"),
  ]);
  const oldHash = "a8280d06412549e7f745ea138350d4113b8430d20a0322fcaed7e74d7a8c04ff";
  const newHash = createHash("sha256").update(migration).digest("hex");
  assert.notEqual(newHash, oldHash);
  assert.equal(newHash, "95d21cae6ded4f5f24b05f9caaab9338599f404ca904a404940001547b02c57e");
  assert.match(runner, /SELECT content_hash FROM schema_migrations WHERE filename = \?/);
  assert.match(runner, /Applied migration was modified/);
  assert.doesNotMatch(runner, /UPDATE\s+schema_migrations/i);
});
