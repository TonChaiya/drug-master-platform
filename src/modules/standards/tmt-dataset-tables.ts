export interface DatasetTableDefinition {
  sourceTable: string;
  targetTable: string;
  primaryKey: string[];
}

export const TMT_TABLES: readonly DatasetTableDefinition[] = [
  { sourceTable: "tmt_concept", targetTable: "tmt_dataset_concepts", primaryKey: ["tmtid"] },
  { sourceTable: "tmt_relationship", targetTable: "tmt_dataset_relationships", primaryKey: ["concept1", "concept2"] },
  { sourceTable: "tmt_mastertmt", targetTable: "tmt_dataset_mastertmt", primaryKey: ["tpucode"] },
  { sourceTable: "tmt_subs", targetTable: "tmt_dataset_subs", primaryKey: ["subsid"] },
  { sourceTable: "tmt_vtm", targetTable: "tmt_dataset_vtm", primaryKey: ["vtmid"] },
  { sourceTable: "tmt_gp", targetTable: "tmt_dataset_gp", primaryKey: ["gpid"] },
  { sourceTable: "tmt_gpu", targetTable: "tmt_dataset_gpu", primaryKey: ["gpuid"] },
  { sourceTable: "tmt_gpp", targetTable: "tmt_dataset_gpp", primaryKey: ["gppid"] },
  { sourceTable: "tmt_tp", targetTable: "tmt_dataset_tp", primaryKey: ["tpid"] },
  { sourceTable: "tmt_tpu", targetTable: "tmt_dataset_tpu", primaryKey: ["tpuid"] },
  { sourceTable: "tmt_tpp", targetTable: "tmt_dataset_tpp", primaryKey: ["tppid"] },
  { sourceTable: "tmt_nlem", targetTable: "tmt_dataset_nlem", primaryKey: ["tpuid", "change_date", "nlem"] },
  { sourceTable: "tmt_atc", targetTable: "tmt_dataset_atc", primaryKey: ["tpuid", "change_date", "atc"] },
  { sourceTable: "tmt_regno", targetTable: "tmt_dataset_regno", primaryKey: ["tpuid", "change_date", "regno"] },
];

export function versionedTmtTable(liveTable: string): string {
  const definition = TMT_TABLES.find((table) => table.sourceTable === liveTable);
  if (!definition) throw new Error("Unknown TMT source table");
  return definition.targetTable;
}
