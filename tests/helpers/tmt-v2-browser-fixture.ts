import type { Pool } from "mysql2/promise";

export const GPU_ID = "764169";
export const TPU_IDS = ["565818", "566021", "736460", "764182", "838408", "864230", "1181555", "565737", "1350824"] as const;

const timestamp = new Date("2026-11-04T00:00:00.000Z");
const version = "20261102";

async function insertRows(pool: Pool, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
  await pool.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${values}`, rows.flat());
}

export async function resetTmtBrowserFixture(pool: Pool): Promise<void> {
  for (const table of [
    "tmt_relationship", "tmt_regno", "tmt_atc", "tmt_nlem", "tmt_mastertmt", "tmt_tpp", "tmt_tpu",
    "tmt_tp", "tmt_gpp", "tmt_gpu", "tmt_gp", "tmt_vtm", "tmt_subs", "tmt_concept",
  ]) await pool.query(`DELETE FROM ${table}`);

  const concepts: Array<[string, string, string]> = [
    [GPU_ID, "lidocaine hydrochloride 400 mg/20 mL solution for injection, 20 mL vial (GPU)", "gpu"],
    ["7641690", "lidocaine prefix control (GPU)", "gpu"],
    ["1147579", "lidocaine hydrochloride injectable product (GP)", "gp"],
    ...TPU_IDS.map((id, index) => [id, id === "764182" ? "LIDOCAINE HYDROCHLORIDE 400 mg/20 mL solution for injection, 20 mL vial (TPU)" : `lidocaine trade ${index + 1} (TPU)`, "tpu"] as [string, string, string]),
    ["1181564", "lidocaine pack one (GPP)", "gpp"],
    ["1181586", "lidocaine pack two (GPP)", "gpp"],
    ["1311037", "lidocaine pack three (GPP)", "gpp"],
    ["999001", "cancelled lidocaine (TPU)", "tpu"],
    ["999002", "unknown status lidocaine (TPU)", "tpu"],
    ["999999", "future concept", "future-level"],
    ["2001", "multi parent one (GP)", "gp"],
    ["2002", "multi parent two (GP)", "gp"],
    ["2003", "multi parent target (GPU)", "gpu"],
    ["3001", "self pack (GPP)", "gpp"],
    ["3002", "cycle pack (GPP)", "gpp"],
    ["4001", "pack one (TPP)", "tpp"],
    ["4002", "pack two (TPP)", "tpp"],
  ];
  await insertRows(pool, "tmt_concept", ["tmtid", "fsn", "change_date", "level_name", "normalized_fsn", "source_version", "last_seen_version", "synced_at"], concepts.map(([id, fsn, level]) => [id, fsn, "2026-01-01", level, fsn.toLowerCase(), version, version, timestamp]));

  await insertRows(pool, "tmt_gp", ["gpid", "fsn", "change_date", "normalized_fsn", "source_version", "last_seen_version", "synced_at"], [["1147579", "lidocaine hydrochloride injectable product", "2026-01-01", "lidocaine hydrochloride injectable product", version, version, timestamp]]);
  await insertRows(pool, "tmt_gpu", ["gpuid", "fsn", "change_date", "normalized_fsn", "source_version", "last_seen_version", "synced_at"], [
    [GPU_ID, "lidocaine hydrochloride 400 mg/20 mL solution for injection, 20 mL vial", "2026-01-01", "lidocaine hydrochloride 400 mg/20 ml solution for injection 20 ml vial", version, version, timestamp],
    ["7641690", "lidocaine prefix control", "2026-01-01", "lidocaine prefix control", version, version, timestamp],
  ]);
  await insertRows(pool, "tmt_gpp", ["gppid", "fsn", "change_date", "normalized_fsn", "source_version", "last_seen_version", "synced_at"], ["1181564", "1181586", "1311037"].map((id, index) => [id, `lidocaine pack ${index + 1}`, "2026-01-01", `lidocaine pack ${index + 1}`, version, version, timestamp]));

  const allTpu = [...TPU_IDS, "999001", "999002"];
  await insertRows(pool, "tmt_tpu", ["tpuid", "fsn", "manufacturer", "change_date", "normalized_fsn", "normalized_manufacturer", "source_version", "last_seen_version", "synced_at"], allTpu.map((id, index) => {
    const official = id === "764182";
    const fsn = official ? "LIDOCAINE HYDROCHLORIDE 400 mg/20 mL solution for injection, 20 mL vial" : `lidocaine trade ${index + 1}`;
    const manufacturer = official ? "องค์การเภสัชกรรม" : index === 0 ? "บริษัท แอคมี จำกัด" : "Example Manufacturer";
    return [id, fsn, manufacturer, "2026-01-01", fsn.toLowerCase(), manufacturer.toLowerCase(), version, version, timestamp];
  }));
  await insertRows(pool, "tmt_mastertmt", ["tpucode", "activeingredient", "strength", "dosageform", "contvalue", "contunit", "dispunit", "tradename", "manufacturer", "fsn", "status", "normalized_generic", "normalized_trade", "normalized_manufacturer", "normalized_fsn", "source_version", "last_seen_version", "synced_at"], [...TPU_IDS, "999001"].map((id, index) => {
    const official = id === "764182";
    const tradeName = official ? "LIDOCAINE HYDROCHLORIDE" : `LIDOCAINE ${index + 1}`;
    const manufacturer = official ? "องค์การเภสัชกรรม" : index === 0 ? "บริษัท แอคมี จำกัด" : "Example Manufacturer";
    const fsn = official ? "LIDOCAINE HYDROCHLORIDE 400 mg/20 mL solution for injection, 20 mL vial" : `lidocaine product ${index + 1}`;
    return [id, "lidocaine hydrochloride", official ? "400 mg/20 mL" : "20 mg/mL", "solution for injection", "20", "mL", "vial", tradeName, manufacturer, fsn, id === "999001" ? 1 : 0, "lidocaine hydrochloride", tradeName.toLowerCase(), manufacturer.toLowerCase(), fsn.toLowerCase(), version, version, timestamp];
  }));

  await insertRows(pool, "tmt_relationship", ["concept1", "concept2", "change_date", "level_name1", "level_name2", "source_version", "last_seen_version", "synced_at"], [
    ["1147579", GPU_ID, "2026-01-01", "gp", "gpu", version, version, timestamp],
    ...TPU_IDS.map((id) => [GPU_ID, id, "2026-01-01", "gpu", "tpu", version, version, timestamp]),
    ...["1181564", "1181586", "1311037"].map((id) => [GPU_ID, id, "2026-01-01", "gpu", "gpp", version, version, timestamp]),
    ["2001", "2003", "2026-01-01", "gp", "gpu", version, version, timestamp],
    ["2002", "2003", "2026-01-01", "gp", "gpu", version, version, timestamp],
    ["3001", "3001", "2026-01-01", "gpp", "gpp", version, version, timestamp],
    ["3001", "3002", "2026-01-01", "gpp", "gpp", version, version, timestamp],
    ["3002", "3001", "2026-01-01", "gpp", "gpp", version, version, timestamp],
    ["4001", "4002", "2026-01-01", "tpp", "tpp", version, version, timestamp],
    [GPU_ID, "888888", "2026-01-01", "gpu", "vtm", version, version, timestamp],
  ]);

  await insertRows(pool, "tmt_nlem", ["tpuid", "fsn", "nlem", "change_date", "source_version", "synced_at"], [
    [TPU_IDS[0], "lidocaine", "ED", "2026-01-01", version, timestamp],
    [TPU_IDS[0], "lidocaine", "NED", "2026-02-01", version, timestamp],
  ]);
  await insertRows(pool, "tmt_atc", ["tpuid", "fsn", "atc", "change_date", "source_version", "synced_at"], [
    [TPU_IDS[0], "lidocaine", "N01BB02", "2026-01-01", version, timestamp],
    [TPU_IDS[0], "lidocaine", "N01BB02", "2026-02-01", version, timestamp],
    [TPU_IDS[0], "lidocaine", "N01BB52", "2026-02-01", version, timestamp],
  ]);
  await insertRows(pool, "tmt_regno", ["tpuid", "fsn", "regno", "normalized_regno", "change_date", "source_version", "synced_at"], [
    [TPU_IDS[0], "lidocaine", "1A 123/67", "1a12367", "2026-01-01", version, timestamp],
    [TPU_IDS[0], "lidocaine", "1A 124/67", "1a12467", "2026-02-01", version, timestamp],
    [TPU_IDS[0], "lidocaine", "1A 125/67", "1a12567", "2026-02-01", version, timestamp],
    [TPU_IDS[1], "lidocaine", "1A 200/67", "1a20067", "2026-02-01", version, timestamp],
  ]);
}
