import type { Pool, RowDataPacket } from "mysql2/promise";
import { normalizeRegistrationNumber, normalizeSearchText } from "@/modules/standards/normalize";
import { mappingEligibility, masterTmtStatus, type TmtRelationshipCounts, type TmtSearchResult } from "./browser";
import { TMT_LEVEL_PRESENTATION } from "./presentation";
import type { ActiveStandardRelease } from "@/modules/standards/active-release";

export interface TmtSearchFilters {
  query?: string;
  tmtId?: string;
  fsn?: string;
  genericName?: string;
  tradeName?: string;
  level?: string;
  status?: "active" | "cancelled" | "unknown";
  mappingEligible?: boolean;
  manufacturer?: string;
  registration?: string;
  atc?: string;
  nlem?: string;
  limit?: number;
}

const UNSIGNED_BIGINT_MAX = 18_446_744_073_709_551_615n;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function numericPrefixRanges(prefix: string): Array<[string, string]> {
  if (!/^\d+$/.test(prefix) || prefix.length > 20) return [];
  const base = BigInt(prefix);
  if (base > UNSIGNED_BIGINT_MAX) return [];
  const ranges: Array<[string, string]> = [];
  for (let digits = prefix.length; digits <= 20; digits += 1) {
    const factor = 10n ** BigInt(digits - prefix.length);
    const lower = base * factor;
    if (lower > UNSIGNED_BIGINT_MAX) break;
    const upper = ((base + 1n) * factor) - 1n;
    ranges.push([lower.toString(), (upper > UNSIGNED_BIGINT_MAX ? UNSIGNED_BIGINT_MAX : upper).toString()]);
  }
  return ranges;
}

function emptyRelationships(): TmtRelationshipCounts {
  return { inbound: 0, outbound: 0, inboundByLevel: {}, outboundByLevel: {} };
}

export interface LatestRegnoProjection {
  value: string | null;
  conflict: boolean;
}

interface LatestRegnoRow {
  tmtId: string;
  regno: string;
  changeDate: string | Date;
}

function dateText(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export function collapseLatestRegnoRows(rows: LatestRegnoRow[], ids: string[]): Map<string, LatestRegnoProjection> {
  const result = new Map<string, LatestRegnoProjection>(ids.map((id) => [id, { value: null, conflict: false }]));
  const latest = new Map<string, { changeDate: string; values: Set<string> }>();
  for (const row of rows) {
    const changeDate = dateText(row.changeDate);
    const regno = row.regno.trim() === "" ? null : row.regno;
    const current = latest.get(row.tmtId);
    if (!current || changeDate > current.changeDate) {
      latest.set(row.tmtId, { changeDate, values: new Set(regno === null ? [] : [regno]) });
    } else if (changeDate === current.changeDate && regno !== null) {
      current.values.add(regno);
    }
  }
  for (const [id, item] of latest) {
    const values = [...item.values];
    result.set(id, { value: values.length === 1 ? values[0] : null, conflict: values.length > 1 });
  }
  return result;
}

export async function latestRegnoByTmtIds(pool: Pool, ids: string[], release?: ActiveStandardRelease): Promise<Map<string, LatestRegnoProjection>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const table = release ? "tmt_dataset_regno" : "tmt_regno";
  const datasetWhere = release ? "dataset_id=? AND " : "";
  const datasetJoin = release ? " AND latest.dataset_id=r.dataset_id" : "";
  const params = release ? [release.tmtDatasetId, ...ids, release.tmtDatasetId, ...ids] : [...ids, ...ids];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.tpuid AS tmt_id,r.regno,r.change_date
     FROM ${table} r
     INNER JOIN (
       SELECT ${release ? "dataset_id," : ""}tpuid,MAX(change_date) AS latest_date FROM ${table}
       WHERE ${datasetWhere}tpuid IN (${placeholders}) GROUP BY ${release ? "dataset_id," : ""}tpuid
     ) latest ON latest.tpuid=r.tpuid AND latest.latest_date=r.change_date${datasetJoin}
     WHERE ${release ? "r.dataset_id=? AND " : ""}r.tpuid IN (${placeholders}) ORDER BY r.tpuid,r.regno`,
    params,
  );
  return collapseLatestRegnoRows(rows.map((row) => ({
    tmtId: String(row.tmt_id),
    regno: String(row.regno),
    changeDate: row.change_date instanceof Date ? row.change_date : String(row.change_date),
  })), ids);
}

async function relationshipCounts(pool: Pool, ids: string[], release?: ActiveStandardRelease): Promise<Map<string, TmtRelationshipCounts>> {
  const result = new Map(ids.map((id) => [id, emptyRelationships()]));
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(",");
  const table = release ? "tmt_dataset_relationships" : "tmt_relationship";
  const dataset = release ? "dataset_id=? AND " : "";
  const params = release ? [release.tmtDatasetId, ...ids] : ids;
  const [outbound] = await pool.query<RowDataPacket[]>(
    `SELECT concept1 AS id,level_name2 AS level_name,COUNT(*) AS total FROM ${table}
     WHERE ${dataset}concept1 IN (${placeholders}) GROUP BY concept1,level_name2`, params,
  );
  const [inbound] = await pool.query<RowDataPacket[]>(
    `SELECT concept2 AS id,level_name1 AS level_name,COUNT(*) AS total FROM ${table}
     WHERE ${dataset}concept2 IN (${placeholders}) GROUP BY concept2,level_name1`, params,
  );
  for (const row of outbound) {
    const target = result.get(String(row.id));
    if (!target) continue;
    const count = Number(row.total);
    target.outbound += count;
    target.outboundByLevel[String(row.level_name)] = count;
  }
  for (const row of inbound) {
    const target = result.get(String(row.id));
    if (!target) continue;
    const count = Number(row.total);
    target.inbound += count;
    target.inboundByLevel[String(row.level_name)] = count;
  }
  return result;
}

export async function searchTmt(pool: Pool, filters: TmtSearchFilters, release?: ActiveStandardRelease): Promise<TmtSearchResult[]> {
  const prefix = release ? "tmt_dataset_" : "tmt_";
  const tables = {
    concept: release ? "tmt_dataset_concepts" : "tmt_concept",
    master: `${prefix}mastertmt`, regno: `${prefix}regno`, atc: `${prefix}atc`, nlem: `${prefix}nlem`,
    subs: `${prefix}subs`, vtm: `${prefix}vtm`, gp: `${prefix}gp`, gpu: `${prefix}gpu`, gpp: `${prefix}gpp`, tp: `${prefix}tp`, tpu: `${prefix}tpu`, tpp: `${prefix}tpp`,
  };
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
  const conditions: string[] = [];
  const parameters: unknown[] = [];
  if (release) { conditions.push("c.dataset_id=?"); parameters.push(release.tmtDatasetId); }
  const query = filters.query?.trim();
  let exactCode: string | null = null;

  if (query) {
    if (/^\d+$/.test(query)) {
      const ranges = numericPrefixRanges(query);
      if (ranges.length === 0) return [];
      conditions.push(`(${ranges.map(() => "c.tmtid BETWEEN ? AND ?").join(" OR ")})`);
      for (const range of ranges) parameters.push(...range);
      exactCode = query;
    } else {
      const normalized = normalizeSearchText(query);
      if (!normalized || normalized.length < 2) return [];
      conditions.push("c.normalized_fsn LIKE ?");
      parameters.push(`${escapeLike(normalized)}%`);
    }
  }

  const tmtId = filters.tmtId?.trim();
  if (tmtId) {
    if (!/^\d{1,20}$/.test(tmtId)) return [];
    conditions.push("c.tmtid=?");
    parameters.push(tmtId);
  }

  const fsn = normalizeSearchText(filters.fsn);
  if (fsn) {
    conditions.push("c.normalized_fsn LIKE ?");
    parameters.push(`${escapeLike(fsn)}%`);
  }

  const genericName = normalizeSearchText(filters.genericName);
  if (genericName) {
    conditions.push("m.normalized_generic LIKE ?");
    parameters.push(`${escapeLike(genericName)}%`);
  }

  const tradeName = normalizeSearchText(filters.tradeName);
  if (tradeName) {
    conditions.push("m.normalized_trade LIKE ?");
    parameters.push(`${escapeLike(tradeName)}%`);
  }

  if (filters.level) {
    conditions.push("c.level_name=?");
    parameters.push(filters.level);
  }

  const manufacturer = normalizeSearchText(filters.manufacturer);
  if (manufacturer) {
    conditions.push(`c.tmtid IN (
      SELECT tpid FROM ${tables.tp} WHERE ${release ? "dataset_id=c.dataset_id AND " : ""}normalized_manufacturer LIKE ?
      UNION SELECT tpuid FROM ${tables.tpu} WHERE ${release ? "dataset_id=c.dataset_id AND " : ""}normalized_manufacturer LIKE ?
      UNION SELECT tppid FROM ${tables.tpp} WHERE ${release ? "dataset_id=c.dataset_id AND " : ""}normalized_manufacturer LIKE ?
      UNION SELECT tpucode FROM ${tables.master} WHERE ${release ? "dataset_id=c.dataset_id AND " : ""}normalized_manufacturer LIKE ?
    )`);
    const pattern = `${escapeLike(manufacturer)}%`;
    parameters.push(pattern, pattern, pattern, pattern);
  }

  const registration = normalizeRegistrationNumber(filters.registration);
  if (registration) {
    conditions.push(`c.tmtid IN (SELECT tpuid FROM ${tables.regno} WHERE ${release ? "dataset_id=c.dataset_id AND " : ""}normalized_regno LIKE ?)`);
    parameters.push(`${escapeLike(registration)}%`);
  }
  const atc = filters.atc?.trim().toUpperCase();
  if (atc) {
    conditions.push(`c.tmtid IN (SELECT tpuid FROM ${tables.atc} WHERE ${release ? "dataset_id=c.dataset_id AND " : ""}atc LIKE ?)`);
    parameters.push(`${escapeLike(atc)}%`);
  }
  const nlem = filters.nlem?.trim().toUpperCase();
  if (nlem) {
    conditions.push(`c.tmtid IN (SELECT tpuid FROM ${tables.nlem} WHERE ${release ? "dataset_id=c.dataset_id AND " : ""}nlem LIKE ?)`);
    parameters.push(`${escapeLike(nlem)}%`);
  }

  if (filters.status === "active") conditions.push("(c.level_name<>'tpu' OR m.status=0)");
  if (filters.status === "cancelled") conditions.push("c.level_name='tpu' AND m.status=1");
  if (filters.status === "unknown") conditions.push("(c.level_name<>'tpu' OR m.status IS NULL OR m.status NOT IN (0,1))");
  if (filters.mappingEligible === true) conditions.push("c.level_name='tpu' AND m.status=0");
  if (filters.mappingEligible === false) conditions.push("(c.level_name<>'tpu' OR m.status IS NULL OR m.status<>0)");

  if (conditions.length === 0) return [];
  const ranking = exactCode ? "CASE WHEN c.tmtid=? THEN 0 ELSE 1 END," : "";
  const values = exactCode ? [...parameters, exactCode, limit] : [...parameters, limit];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.tmtid,c.level_name,c.fsn AS concept_fsn,c.source_version,
      COALESCE(s.fsn,v.fsn,gp.fsn,gpu.fsn,gpp.fsn,tp.fsn,tpu.fsn,tpp.fsn) AS endpoint_fsn,
      COALESCE(tp.manufacturer,tpu.manufacturer,tpp.manufacturer,m.manufacturer) AS manufacturer,
      m.status AS master_status,m.activeingredient,m.strength,m.dosageform,m.contvalue,m.contunit,m.dispunit,m.tradename
     FROM ${tables.concept} c
     LEFT JOIN ${tables.subs} s ON c.level_name='subs' AND s.subsid=c.tmtid${release ? " AND s.dataset_id=c.dataset_id" : ""}
     LEFT JOIN ${tables.vtm} v ON c.level_name='vtm' AND v.vtmid=c.tmtid${release ? " AND v.dataset_id=c.dataset_id" : ""}
     LEFT JOIN ${tables.gp} gp ON c.level_name='gp' AND gp.gpid=c.tmtid${release ? " AND gp.dataset_id=c.dataset_id" : ""}
     LEFT JOIN ${tables.gpu} gpu ON c.level_name='gpu' AND gpu.gpuid=c.tmtid${release ? " AND gpu.dataset_id=c.dataset_id" : ""}
     LEFT JOIN ${tables.gpp} gpp ON c.level_name='gpp' AND gpp.gppid=c.tmtid${release ? " AND gpp.dataset_id=c.dataset_id" : ""}
     LEFT JOIN ${tables.tp} tp ON c.level_name='tp' AND tp.tpid=c.tmtid${release ? " AND tp.dataset_id=c.dataset_id" : ""}
     LEFT JOIN ${tables.tpu} tpu ON c.level_name='tpu' AND tpu.tpuid=c.tmtid${release ? " AND tpu.dataset_id=c.dataset_id" : ""}
     LEFT JOIN ${tables.tpp} tpp ON c.level_name='tpp' AND tpp.tppid=c.tmtid${release ? " AND tpp.dataset_id=c.dataset_id" : ""}
     LEFT JOIN ${tables.master} m ON c.level_name='tpu' AND m.tpucode=c.tmtid${release ? " AND m.dataset_id=c.dataset_id" : ""}
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${ranking} c.tmtid
     LIMIT ?`,
    values,
  );

  const ids = rows.map((row) => String(row.tmtid));
  const [counts, regnoById] = await Promise.all([
    relationshipCounts(pool, ids, release),
    latestRegnoByTmtIds(pool, ids, release),
  ]);
  return rows.map((row) => {
    const level = String(row.level_name);
    const masterStatus = row.master_status === null || row.master_status === undefined ? null : Number(row.master_status);
    const eligibility = mappingEligibility(level, masterStatus);
    const warnings: string[] = [];
    if (!(level in TMT_LEVEL_PRESENTATION)) warnings.push("พบ level ที่ระบบยังไม่รู้จัก");
    if (!row.endpoint_fsn) warnings.push("ไม่พบข้อมูลในตารางระดับของ concept นี้");
    if (level === "tpu" && masterStatus === null) warnings.push("ไม่พบ MasterTMT สำหรับ TPU นี้");
    if (level === "tpu" && masterStatus !== null && masterStatus !== 0 && masterStatus !== 1) warnings.push("พบสถานะ MasterTMT ที่ระบบยังไม่รู้จัก");
    return {
      tmtId: String(row.tmtid),
      level,
      conceptFsn: String(row.concept_fsn),
      endpointFsn: row.endpoint_fsn === null ? null : String(row.endpoint_fsn),
      manufacturer: row.manufacturer === null ? null : String(row.manufacturer),
      status: masterTmtStatus(masterStatus),
      masterStatus,
      sourceVersion: String(row.source_version),
      mappingEligible: eligibility.eligible,
      mappingEligibilityReason: eligibility.reason,
      dataQualityWarnings: warnings.slice(0, 5),
      relationships: counts.get(String(row.tmtid)) ?? emptyRelationships(),
      activeIngredient: row.activeingredient === null ? null : String(row.activeingredient),
      strength: row.strength === null ? null : String(row.strength),
      dosageForm: row.dosageform === null ? null : String(row.dosageform),
      contentValue: row.contvalue === null ? null : String(row.contvalue),
      contentUnit: row.contunit === null ? null : String(row.contunit),
      dispensingUnit: row.dispunit === null ? null : String(row.dispunit),
      tradeName: row.tradename === null ? null : String(row.tradename),
      registrationNumber: regnoById.get(String(row.tmtid))?.value ?? null,
      registrationConflict: regnoById.get(String(row.tmtid))?.conflict ?? false,
    };
  });
}
