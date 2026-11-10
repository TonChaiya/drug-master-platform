import type { Pool, RowDataPacket } from "mysql2/promise";
import { normalizeRegistrationNumber, normalizeSearchText } from "@/modules/standards/normalize";
import { mappingEligibility, masterTmtStatus, type TmtRelationshipCounts, type TmtSearchResult } from "./browser";
import { TMT_LEVEL_PRESENTATION } from "./presentation";

export interface TmtSearchFilters {
  query?: string;
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

export async function latestRegnoByTmtIds(pool: Pool, ids: string[]): Promise<Map<string, LatestRegnoProjection>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.tpuid AS tmt_id,r.regno,r.change_date
     FROM tmt_regno r
     INNER JOIN (
       SELECT tpuid,MAX(change_date) AS latest_date FROM tmt_regno
       WHERE tpuid IN (${placeholders}) GROUP BY tpuid
     ) latest ON latest.tpuid=r.tpuid AND latest.latest_date=r.change_date
     WHERE r.tpuid IN (${placeholders}) ORDER BY r.tpuid,r.regno`,
    [...ids, ...ids],
  );
  return collapseLatestRegnoRows(rows.map((row) => ({
    tmtId: String(row.tmt_id),
    regno: String(row.regno),
    changeDate: row.change_date instanceof Date ? row.change_date : String(row.change_date),
  })), ids);
}

async function relationshipCounts(pool: Pool, ids: string[]): Promise<Map<string, TmtRelationshipCounts>> {
  const result = new Map(ids.map((id) => [id, emptyRelationships()]));
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(",");
  const [outbound] = await pool.query<RowDataPacket[]>(
    `SELECT concept1 AS id,level_name2 AS level_name,COUNT(*) AS total FROM tmt_relationship
     WHERE concept1 IN (${placeholders}) GROUP BY concept1,level_name2`,
    ids,
  );
  const [inbound] = await pool.query<RowDataPacket[]>(
    `SELECT concept2 AS id,level_name1 AS level_name,COUNT(*) AS total FROM tmt_relationship
     WHERE concept2 IN (${placeholders}) GROUP BY concept2,level_name1`,
    ids,
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

export async function searchTmt(pool: Pool, filters: TmtSearchFilters): Promise<TmtSearchResult[]> {
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
  const conditions: string[] = [];
  const parameters: unknown[] = [];
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

  if (filters.level) {
    conditions.push("c.level_name=?");
    parameters.push(filters.level);
  }

  const manufacturer = normalizeSearchText(filters.manufacturer);
  if (manufacturer) {
    conditions.push(`c.tmtid IN (
      SELECT tpid FROM tmt_tp WHERE normalized_manufacturer LIKE ?
      UNION SELECT tpuid FROM tmt_tpu WHERE normalized_manufacturer LIKE ?
      UNION SELECT tppid FROM tmt_tpp WHERE normalized_manufacturer LIKE ?
      UNION SELECT tpucode FROM tmt_mastertmt WHERE normalized_manufacturer LIKE ?
    )`);
    const pattern = `${escapeLike(manufacturer)}%`;
    parameters.push(pattern, pattern, pattern, pattern);
  }

  const registration = normalizeRegistrationNumber(filters.registration);
  if (registration) {
    conditions.push("c.tmtid IN (SELECT tpuid FROM tmt_regno WHERE normalized_regno LIKE ?)");
    parameters.push(`${escapeLike(registration)}%`);
  }
  const atc = filters.atc?.trim().toUpperCase();
  if (atc) {
    conditions.push("c.tmtid IN (SELECT tpuid FROM tmt_atc WHERE atc LIKE ?)");
    parameters.push(`${escapeLike(atc)}%`);
  }
  const nlem = filters.nlem?.trim().toUpperCase();
  if (nlem) {
    conditions.push("c.tmtid IN (SELECT tpuid FROM tmt_nlem WHERE nlem LIKE ?)");
    parameters.push(`${escapeLike(nlem)}%`);
  }

  if (filters.status === "active" || filters.mappingEligible === true) conditions.push("c.level_name='tpu' AND m.status=0");
  if (filters.status === "cancelled") conditions.push("c.level_name='tpu' AND m.status=1");
  if (filters.status === "unknown") conditions.push("(c.level_name<>'tpu' OR m.status IS NULL OR m.status NOT IN (0,1))");
  if (filters.mappingEligible === false) conditions.push("(c.level_name<>'tpu' OR m.status IS NULL OR m.status<>0)");

  if (conditions.length === 0) return [];
  const ranking = exactCode ? "CASE WHEN c.tmtid=? THEN 0 ELSE 1 END," : "";
  const values = exactCode ? [...parameters, exactCode, limit] : [...parameters, limit];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.tmtid,c.level_name,c.fsn AS concept_fsn,c.source_version,
      COALESCE(s.fsn,v.fsn,gp.fsn,gpu.fsn,gpp.fsn,tp.fsn,tpu.fsn,tpp.fsn) AS endpoint_fsn,
      COALESCE(tp.manufacturer,tpu.manufacturer,tpp.manufacturer,m.manufacturer) AS manufacturer,
      m.status AS master_status,m.activeingredient,m.strength,m.dosageform,m.contvalue,m.contunit,m.dispunit,m.tradename
     FROM tmt_concept c
     LEFT JOIN tmt_subs s ON c.level_name='subs' AND s.subsid=c.tmtid
     LEFT JOIN tmt_vtm v ON c.level_name='vtm' AND v.vtmid=c.tmtid
     LEFT JOIN tmt_gp gp ON c.level_name='gp' AND gp.gpid=c.tmtid
     LEFT JOIN tmt_gpu gpu ON c.level_name='gpu' AND gpu.gpuid=c.tmtid
     LEFT JOIN tmt_gpp gpp ON c.level_name='gpp' AND gpp.gppid=c.tmtid
     LEFT JOIN tmt_tp tp ON c.level_name='tp' AND tp.tpid=c.tmtid
     LEFT JOIN tmt_tpu tpu ON c.level_name='tpu' AND tpu.tpuid=c.tmtid
     LEFT JOIN tmt_tpp tpp ON c.level_name='tpp' AND tpp.tppid=c.tmtid
     LEFT JOIN tmt_mastertmt m ON c.level_name='tpu' AND m.tpucode=c.tmtid
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${ranking} c.tmtid
     LIMIT ?`,
    values,
  );

  const ids = rows.map((row) => String(row.tmtid));
  const [counts, regnoById] = await Promise.all([
    relationshipCounts(pool, ids),
    latestRegnoByTmtIds(pool, ids),
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
