import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ActiveStandardRelease } from "@/modules/standards/active-release";

export interface TmtRelationshipEdge {
  concept1: string;
  concept2: string;
  levelName1: string;
  levelName2: string;
  changeDate: string;
  direction: "inbound" | "outbound";
  relatedId: string;
  relatedLevel: string;
  relatedConcept: { tmtId: string; fsn: string; level: string; sourceVersion: string } | null;
}

export interface TmtDirectRelationships {
  inbound: TmtRelationshipEdge[];
  outbound: TmtRelationshipEdge[];
}

export interface TmtGraphNode {
  tmtId: string;
  fsn: string | null;
  level: string;
  sourceVersion: string | null;
  depth: number;
  available: boolean;
}

export interface TmtGraphResult {
  nodes: TmtGraphNode[];
  edges: Array<Omit<TmtRelationshipEdge, "direction" | "relatedId" | "relatedLevel" | "relatedConcept">>;
  truncated: boolean;
}

function databaseDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function edge(row: RowDataPacket, direction: "inbound" | "outbound"): TmtRelationshipEdge {
  const relatedId = String(direction === "outbound" ? row.concept2 : row.concept1);
  const relatedLevel = String(direction === "outbound" ? row.level_name2 : row.level_name1);
  return {
    concept1: String(row.concept1),
    concept2: String(row.concept2),
    levelName1: String(row.level_name1),
    levelName2: String(row.level_name2),
    changeDate: databaseDate(row.change_date),
    direction,
    relatedId,
    relatedLevel,
    relatedConcept: row.related_id === null ? null : {
      tmtId: String(row.related_id),
      fsn: String(row.related_fsn),
      level: String(row.related_level),
      sourceVersion: String(row.related_version),
    },
  };
}

async function loadEdgesForIds(pool: Pool, ids: string[], limit: number, release?: ActiveStandardRelease): Promise<TmtDirectRelationships> {
  if (ids.length === 0) return { inbound: [], outbound: [] };
  const placeholders = ids.map(() => "?").join(",");
  const relationships = release ? "tmt_dataset_relationships" : "tmt_relationship";
  const concepts = release ? "tmt_dataset_concepts" : "tmt_concept";
  const joinDataset = release ? " AND c.dataset_id=r.dataset_id" : "";
  const whereDataset = release ? "r.dataset_id=? AND " : "";
  const parameters = release ? [release.tmtDatasetId, ...ids, limit] : [...ids, limit];
  const [outbound] = await pool.query<RowDataPacket[]>(
    `SELECT r.*,c.tmtid AS related_id,c.fsn AS related_fsn,c.level_name AS related_level,c.source_version AS related_version
     FROM ${relationships} r LEFT JOIN ${concepts} c ON c.tmtid=r.concept2${joinDataset}
     WHERE ${whereDataset}r.concept1 IN (${placeholders}) ORDER BY r.concept1,r.concept2 LIMIT ?`, parameters,
  );
  const [inbound] = await pool.query<RowDataPacket[]>(
    `SELECT r.*,c.tmtid AS related_id,c.fsn AS related_fsn,c.level_name AS related_level,c.source_version AS related_version
     FROM ${relationships} r LEFT JOIN ${concepts} c ON c.tmtid=r.concept1${joinDataset}
     WHERE ${whereDataset}r.concept2 IN (${placeholders}) ORDER BY r.concept2,r.concept1 LIMIT ?`, parameters,
  );
  return {
    inbound: inbound.map((row) => edge(row, "inbound")),
    outbound: outbound.map((row) => edge(row, "outbound")),
  };
}

export async function loadDirectTmtRelationships(pool: Pool, tmtId: string, limit = 100, release?: ActiveStandardRelease): Promise<TmtDirectRelationships> {
  return loadEdgesForIds(pool, [tmtId], Math.min(Math.max(limit, 1), 200), release);
}

export async function traverseTmtGraph(
  pool: Pool,
  startId: string,
  options: { maxDepth?: number; maxNodes?: number } = {},
  release?: ActiveStandardRelease,
): Promise<TmtGraphResult> {
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 2, 0), 4);
  const maxNodes = Math.min(Math.max(options.maxNodes ?? 200, 1), 200);
  const conceptTable = release ? "tmt_dataset_concepts" : "tmt_concept";
  const [startRows] = await pool.query<RowDataPacket[]>(`SELECT tmtid,fsn,level_name,source_version FROM ${conceptTable} WHERE ${release ? "dataset_id=? AND " : ""}tmtid=? LIMIT 1`, release ? [release.tmtDatasetId, startId] : [startId]);
  const start = startRows[0];
  const nodes: TmtGraphNode[] = [{
    tmtId: startId,
    fsn: start ? String(start.fsn) : null,
    level: start ? String(start.level_name) : "unknown",
    sourceVersion: start ? String(start.source_version) : null,
    depth: 0,
    available: Boolean(start),
  }];
  const visited = new Set([startId]);
  const edgeKeys = new Set<string>();
  const edges: TmtGraphResult["edges"] = [];
  let frontier = [startId];
  let truncated = false;

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const direct = await loadEdgesForIds(pool, frontier, maxNodes, release);
    const candidates = [...direct.outbound, ...direct.inbound];
    const next: string[] = [];
    for (const item of candidates) {
      const key = `${item.concept1}:${item.concept2}`;
      if (!edgeKeys.has(key)) {
        if (edges.length >= maxNodes) {
          truncated = true;
          break;
        }
        edgeKeys.add(key);
        edges.push({
          concept1: item.concept1,
          concept2: item.concept2,
          levelName1: item.levelName1,
          levelName2: item.levelName2,
          changeDate: item.changeDate,
        });
      }
      if (visited.has(item.relatedId)) continue;
      if (nodes.length >= maxNodes) {
        truncated = true;
        continue;
      }
      visited.add(item.relatedId);
      nodes.push({
        tmtId: item.relatedId,
        fsn: item.relatedConcept?.fsn ?? null,
        level: item.relatedConcept?.level ?? item.relatedLevel,
        sourceVersion: item.relatedConcept?.sourceVersion ?? null,
        depth,
        available: item.relatedConcept !== null,
      });
      if (item.relatedConcept) next.push(item.relatedId);
    }
    frontier = next;
  }
  return { nodes, edges, truncated };
}
