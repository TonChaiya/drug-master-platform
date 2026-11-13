import assert from "node:assert/strict";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { test } from "vitest";
import {
  standardDatasetManifests,
  standardDatasetPointers,
  standardDatasets,
  standardReleases,
  tmtDatasetConcepts,
  tmtDatasetRegno,
  tmtDatasetRelationships,
  ttmtDatasetProducts,
} from "@/db/schema/standard-datasets";

test("versioned standard foundation keeps datasets immutable and consumers pointer-driven", () => {
  assert.deepEqual(
    [standardDatasets, standardReleases, standardDatasetPointers, standardDatasetManifests].map(getTableName),
    ["standard_datasets", "standard_releases", "standard_dataset_pointers", "standard_dataset_manifests"],
  );

  assert.deepEqual(
    getTableConfig(standardReleases).foreignKeys.map((key) => key.reference().foreignColumns[0]?.name).sort(),
    ["id", "id", "run_id"],
  );
  assert.equal(getTableConfig(standardDatasetPointers).foreignKeys[0]?.reference().foreignColumns[0]?.name, "id");
  assert.equal(getTableConfig(standardDatasetManifests).primaryKeys[0]?.columns.map((column) => column.name).join(","), "dataset_id,table_name");
});

test("versioned source tables isolate equal standard identities by dataset", () => {
  assert.deepEqual(
    getTableConfig(tmtDatasetConcepts).primaryKeys[0]?.columns.map((column) => column.name),
    ["dataset_id", "tmtid"],
  );
  assert.deepEqual(
    getTableConfig(tmtDatasetRelationships).primaryKeys[0]?.columns.map((column) => column.name),
    ["dataset_id", "concept1", "concept2"],
  );
  assert.deepEqual(
    getTableConfig(tmtDatasetRegno).primaryKeys[0]?.columns.map((column) => column.name),
    ["dataset_id", "tpuid", "change_date", "regno"],
  );
  assert.deepEqual(
    getTableConfig(ttmtDatasetProducts).primaryKeys[0]?.columns.map((column) => column.name),
    ["dataset_id", "ttmtcode"],
  );
  assert.ok(getTableConfig(tmtDatasetConcepts).indexes.some((index) => index.config.name === "idx_tmt_dataset_concept_lookup"));
  assert.ok(getTableConfig(ttmtDatasetProducts).indexes.some((index) => index.config.name === "idx_ttmt_dataset_product_lookup"));
});
