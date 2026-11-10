import type { Pool, RowDataPacket } from "mysql2/promise";

export interface InvariantIssue {
  count: number;
  examples: Array<Record<string, string | number | null>>;
}

export interface TmtInvariantReport {
  countsByLevel: Record<string, number>;
  tableCounts: Record<string, number>;
  missingConceptCounterparts: InvariantIssue;
  missingEndpointCounterparts: InvariantIssue;
  levelMismatch: InvariantIssue;
  fsnUnexpectedMismatch: InvariantIssue;
  masterTmtMissingTpu: InvariantIssue;
  masterTmtMissingConcept: InvariantIssue;
  tpuMissingMasterTmt: InvariantIssue;
  danglingRelationshipConcepts: InvariantIssue;
  unknownLevels: InvariantIssue;
  selfRelationships: InvariantIssue;
  duplicateRelationshipPairs: InvariantIssue;
  enrichmentConflicts: { nlem: InvariantIssue; atc: InvariantIssue; regno: InvariantIssue };
  unknownMasterStatuses: InvariantIssue;
  optionalFailures: Array<{ endpoint: string; errorCode: string }>;
  versionDrift: boolean;
}

const levelTables = [
  ["subs", "tmt_subs", "subsid"], ["vtm", "tmt_vtm", "vtmid"], ["gp", "tmt_gp", "gpid"],
  ["gpu", "tmt_gpu", "gpuid"], ["gpp", "tmt_gpp", "gppid"], ["tp", "tmt_tp", "tpid"],
  ["tpu", "tmt_tpu", "tpuid"], ["tpp", "tmt_tpp", "tppid"],
] as const;

const sourceTables = [
  "tmt_subs", "tmt_vtm", "tmt_gp", "tmt_gpu", "tmt_gpp", "tmt_tp", "tmt_tpu", "tmt_tpp",
  "tmt_nlem", "tmt_atc", "tmt_regno", "tmt_mastertmt", "tmt_concept", "tmt_relationship", "tmt_version",
] as const;

function value(row: RowDataPacket): Record<string, string | number | null> {
  return Object.fromEntries(Object.entries(row).map(([key, entry]) => {
    if (typeof entry === "bigint") return [key, entry.toString()];
    if (entry instanceof Date) return [key, entry.toISOString()];
    return [key, entry as string | number | null];
  }));
}

type QueryExecutor = Pick<Pool, "query">;

async function issue(pool: QueryExecutor, body: string, parameters: unknown[], exampleLimit: number): Promise<InvariantIssue> {
  const [[count]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM (${body}) AS invariant_rows`, parameters);
  const [examples] = await pool.query<RowDataPacket[]>(`${body} LIMIT ?`, [...parameters, exampleLimit]);
  return { count: Number(count?.total ?? 0), examples: examples.map(value) };
}

function unionConceptMissing(): string {
  return levelTables.map(([level, table, id]) =>
    `SELECT CAST(c.tmtid AS CHAR) AS tmtid,c.level_name FROM tmt_concept c LEFT JOIN ${table} e ON e.${id}=c.tmtid WHERE LOWER(c.level_name)='${level}' AND e.${id} IS NULL`,
  ).join(" UNION ALL ");
}

function unionEndpointMissing(): string {
  return levelTables.map(([level, table, id]) =>
    `SELECT CAST(e.${id} AS CHAR) AS tmtid,'${level}' AS endpoint_level FROM ${table} e LEFT JOIN tmt_concept c ON c.tmtid=e.${id} WHERE c.tmtid IS NULL`,
  ).join(" UNION ALL ");
}

function unionLevelMismatch(): string {
  return levelTables.map(([level, table, id]) =>
    `SELECT CAST(e.${id} AS CHAR) AS tmtid,'${level}' AS endpoint_level,c.level_name AS concept_level FROM ${table} e JOIN tmt_concept c ON c.tmtid=e.${id} WHERE LOWER(c.level_name)<>'${level}'`,
  ).join(" UNION ALL ");
}

function unionFsnMismatch(): string {
  return levelTables.map(([level, table, id]) =>
    `SELECT CAST(e.${id} AS CHAR) AS tmtid,'${level}' AS endpoint_level FROM ${table} e JOIN tmt_concept c ON c.tmtid=e.${id} WHERE LOWER(TRIM(e.fsn))<>LOWER(TRIM(CASE WHEN RIGHT(c.fsn,${level.length + 3})=' (${level.toUpperCase()})' THEN LEFT(c.fsn,CHAR_LENGTH(c.fsn)-${level.length + 3}) ELSE c.fsn END))`,
  ).join(" UNION ALL ");
}

async function enrichmentConflict(pool: QueryExecutor, table: string, column: string, exampleLimit: number): Promise<InvariantIssue> {
  return issue(pool,
    `SELECT CAST(tpuid AS CHAR) AS tpuid,DATE_FORMAT(change_date,'%Y-%m-%d') AS change_date,COUNT(DISTINCT ${column}) AS value_count FROM ${table} GROUP BY tpuid,change_date HAVING COUNT(DISTINCT ${column})>1`,
    [], exampleLimit);
}

export async function buildTmtInvariantReport(
  pool: QueryExecutor,
  options: { optionalFailures?: Array<{ endpoint: string; errorCode: string }>; versionDrift?: boolean; exampleLimit?: number } = {},
): Promise<TmtInvariantReport> {
  const exampleLimit = Math.max(1, Math.min(50, options.exampleLimit ?? 10));
  const [levelRows] = await pool.query<RowDataPacket[]>("SELECT LOWER(level_name) AS level_name,COUNT(*) AS total FROM tmt_concept GROUP BY LOWER(level_name)");
  const countsByLevel = Object.fromEntries(levelRows.map((row) => [String(row.level_name), Number(row.total)]));
  const tableCounts: Record<string, number> = {};
  for (const table of sourceTables) {
    const [[row]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${table}`);
    tableCounts[table] = Number(row?.total ?? 0);
  }

  const [
    missingConceptCounterparts,
    missingEndpointCounterparts,
    levelMismatch,
    fsnUnexpectedMismatch,
    masterTmtMissingTpu,
    masterTmtMissingConcept,
    tpuMissingMasterTmt,
    danglingRelationshipConcepts,
    unknownLevels,
    selfRelationships,
    duplicateRelationshipPairs,
    unknownMasterStatuses,
    nlem,
    atc,
    regno,
  ] = await Promise.all([
    issue(pool, unionConceptMissing(), [], exampleLimit),
    issue(pool, unionEndpointMissing(), [], exampleLimit),
    issue(pool, unionLevelMismatch(), [], exampleLimit),
    issue(pool, unionFsnMismatch(), [], exampleLimit),
    issue(pool, "SELECT CAST(m.tpucode AS CHAR) AS tpucode FROM tmt_mastertmt m LEFT JOIN tmt_tpu t ON t.tpuid=m.tpucode WHERE t.tpuid IS NULL", [], exampleLimit),
    issue(pool, "SELECT CAST(m.tpucode AS CHAR) AS tpucode FROM tmt_mastertmt m LEFT JOIN tmt_concept c ON c.tmtid=m.tpucode WHERE c.tmtid IS NULL", [], exampleLimit),
    issue(pool, "SELECT CAST(t.tpuid AS CHAR) AS tpuid FROM tmt_tpu t LEFT JOIN tmt_mastertmt m ON m.tpucode=t.tpuid WHERE m.tpucode IS NULL", [], exampleLimit),
    issue(pool, "SELECT CAST(r.concept1 AS CHAR) AS concept1,CAST(r.concept2 AS CHAR) AS concept2 FROM tmt_relationship r LEFT JOIN tmt_concept c1 ON c1.tmtid=r.concept1 LEFT JOIN tmt_concept c2 ON c2.tmtid=r.concept2 WHERE c1.tmtid IS NULL OR c2.tmtid IS NULL", [], exampleLimit),
    issue(pool, "SELECT CAST(tmtid AS CHAR) AS tmtid,level_name FROM tmt_concept WHERE LOWER(level_name) NOT IN ('subs','vtm','gp','gpu','gpp','tp','tpu','tpp')", [], exampleLimit),
    issue(pool, "SELECT CAST(concept1 AS CHAR) AS concept1 FROM tmt_relationship WHERE concept1=concept2", [], exampleLimit),
    issue(pool, "SELECT CAST(concept1 AS CHAR) AS concept1,CAST(concept2 AS CHAR) AS concept2,COUNT(*) AS copies FROM tmt_relationship GROUP BY concept1,concept2 HAVING COUNT(*)>1", [], exampleLimit),
    issue(pool, "SELECT CAST(tpucode AS CHAR) AS tpucode,status FROM tmt_mastertmt WHERE status NOT IN (0,1)", [], exampleLimit),
    enrichmentConflict(pool, "tmt_nlem", "nlem", exampleLimit),
    enrichmentConflict(pool, "tmt_atc", "atc", exampleLimit),
    enrichmentConflict(pool, "tmt_regno", "regno", exampleLimit),
  ]);

  return {
    countsByLevel,
    tableCounts,
    missingConceptCounterparts,
    missingEndpointCounterparts,
    levelMismatch,
    fsnUnexpectedMismatch,
    masterTmtMissingTpu,
    masterTmtMissingConcept,
    tpuMissingMasterTmt,
    danglingRelationshipConcepts,
    unknownLevels,
    selfRelationships,
    duplicateRelationshipPairs,
    enrichmentConflicts: { nlem, atc, regno },
    unknownMasterStatuses,
    optionalFailures: options.optionalFailures ?? [],
    versionDrift: options.versionDrift ?? false,
  };
}

export interface TmtGpuAcceptance {
  gpu: { gpuid: string; fsn: string } | null;
  concept: { tmtid: string; fsn: string; levelName: string } | null;
  inboundGp: number;
  outboundTpu: number;
  outboundGpp: number;
  relatedTpuIds: string[];
  relatedTpuPresent: number;
  relatedMasterTmtPresent: number;
  relatedConceptPresent: number;
  masterStatuses: Array<{ tpucode: string; status: number }>;
}

export async function verifyTmtGpuAcceptance(pool: QueryExecutor, code: string): Promise<TmtGpuAcceptance> {
  if (!/^\d+$/.test(code)) throw new Error("TMT code must be numeric");
  const [[gpu]] = await pool.query<RowDataPacket[]>("SELECT CAST(gpuid AS CHAR) AS gpuid,fsn FROM tmt_gpu WHERE gpuid=? LIMIT 1", [code]);
  const [[concept]] = await pool.query<RowDataPacket[]>("SELECT CAST(tmtid AS CHAR) AS tmtid,fsn,LOWER(level_name) AS level_name FROM tmt_concept WHERE tmtid=? LIMIT 1", [code]);
  const [[inbound]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM tmt_relationship WHERE concept2=? AND LOWER(level_name1)='gp'", [code]);
  const [tpuEdges] = await pool.query<RowDataPacket[]>("SELECT CAST(concept2 AS CHAR) AS tmtid FROM tmt_relationship WHERE concept1=? AND LOWER(level_name2)='tpu' ORDER BY concept2", [code]);
  const [[gpp]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM tmt_relationship WHERE concept1=? AND LOWER(level_name2)='gpp'", [code]);
  const ids = tpuEdges.map((row) => String(row.tmtid));
  let relatedTpuPresent = 0;
  let relatedMasterTmtPresent = 0;
  let relatedConceptPresent = 0;
  let masterStatuses: Array<{ tpucode: string; status: number }> = [];
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const [[tpuCount]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM tmt_tpu WHERE tpuid IN (${placeholders})`, ids);
    const [master] = await pool.query<RowDataPacket[]>(`SELECT CAST(tpucode AS CHAR) AS tpucode,status FROM tmt_mastertmt WHERE tpucode IN (${placeholders}) ORDER BY tpucode`, ids);
    const [[conceptCount]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM tmt_concept WHERE tmtid IN (${placeholders})`, ids);
    relatedTpuPresent = Number(tpuCount?.total ?? 0);
    relatedMasterTmtPresent = master.length;
    relatedConceptPresent = Number(conceptCount?.total ?? 0);
    masterStatuses = master.map((row) => ({ tpucode: String(row.tpucode), status: Number(row.status) }));
  }
  return {
    gpu: gpu ? { gpuid: String(gpu.gpuid), fsn: gpu.fsn } : null,
    concept: concept ? { tmtid: String(concept.tmtid), fsn: concept.fsn, levelName: concept.level_name } : null,
    inboundGp: Number(inbound?.total ?? 0),
    outboundTpu: ids.length,
    outboundGpp: Number(gpp?.total ?? 0),
    relatedTpuIds: ids,
    relatedTpuPresent,
    relatedMasterTmtPresent,
    relatedConceptPresent,
    masterStatuses,
  };
}
