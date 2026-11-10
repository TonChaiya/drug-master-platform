import type { Pool, RowDataPacket } from "mysql2/promise";
import { mappingEligibility, masterTmtStatus, type LatestTmtValues, type TmtSearchResult } from "./browser";
import { loadDirectTmtRelationships, traverseTmtGraph, type TmtDirectRelationships, type TmtGraphResult } from "./graph";
import { TmtSyncRepository } from "./persistence";
import { latestRegnoByTmtIds, searchTmt } from "./search";

export interface TmtRelatedTpu {
  tmtId: string;
  conceptFsn: string;
  endpointFsn: string | null;
  manufacturer: string | null;
  tradeName: string | null;
  registrationNumber: string | null;
  registrationConflict: boolean;
  status: "active" | "cancelled" | "unknown";
  mappingEligible: boolean;
  mappingEligibilityReason: string;
}

export interface TmtConceptDetail {
  concept: TmtSearchResult;
  masterTmt: {
    activeIngredient: string | null;
    strength: string | null;
    dosageForm: string | null;
    contentValue: string | null;
    contentUnit: string | null;
    dispensingUnit: string | null;
    tradeName: string | null;
    manufacturer: string | null;
    status: number;
  } | null;
  nlem: LatestTmtValues | null;
  atc: LatestTmtValues | null;
  regno: LatestTmtValues | null;
  direct: TmtDirectRelationships;
  graph: TmtGraphResult;
  relatedTpu: TmtRelatedTpu[];
  warnings: string[];
}

async function relatedTpu(pool: Pool, ids: string[]): Promise<TmtRelatedTpu[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.tmtid,c.fsn AS concept_fsn,t.fsn AS endpoint_fsn,t.manufacturer,m.tradename,m.status
     FROM tmt_concept c
     LEFT JOIN tmt_tpu t ON t.tpuid=c.tmtid
     LEFT JOIN tmt_mastertmt m ON m.tpucode=c.tmtid
     WHERE c.level_name='tpu' AND c.tmtid IN (${placeholders}) ORDER BY c.tmtid`,
    ids,
  );
  const regnoById = await latestRegnoByTmtIds(pool, ids);
  return rows.map((row) => {
    const status = row.status === null || row.status === undefined ? null : Number(row.status);
    const eligibility = mappingEligibility("tpu", status);
    return {
      tmtId: String(row.tmtid),
      conceptFsn: String(row.concept_fsn),
      endpointFsn: row.endpoint_fsn === null ? null : String(row.endpoint_fsn),
      manufacturer: row.manufacturer === null ? null : String(row.manufacturer),
      tradeName: row.tradename === null ? null : String(row.tradename),
      registrationNumber: regnoById.get(String(row.tmtid))?.value ?? null,
      registrationConflict: regnoById.get(String(row.tmtid))?.conflict ?? false,
      status: masterTmtStatus(status),
      mappingEligible: eligibility.eligible,
      mappingEligibilityReason: eligibility.reason,
    };
  });
}

export async function getTmtConceptDetail(
  pool: Pool,
  tmtId: string,
  options: { graphDepth?: number; maxNodes?: number } = {},
): Promise<TmtConceptDetail | null> {
  const matches = await searchTmt(pool, { query: tmtId, limit: 100 });
  const concept = matches.find((row) => row.tmtId === tmtId);
  if (!concept) return null;

  const direct = await loadDirectTmtRelationships(pool, tmtId, 100);
  const graph = await traverseTmtGraph(pool, tmtId, { maxDepth: options.graphDepth, maxNodes: options.maxNodes });
  const repository = new TmtSyncRepository(pool);
  const [nlem, atc, regno] = concept.level === "tpu"
    ? await Promise.all([repository.latestNlem(tmtId), repository.latestAtc(tmtId), repository.latestRegno(tmtId)])
    : [null, null, null];
  const tpuIds = direct.outbound.filter((item) => item.relatedLevel === "tpu").map((item) => item.relatedId);
  const related = await relatedTpu(pool, tpuIds);
  const warnings = [...concept.dataQualityWarnings];
  if ([...direct.inbound, ...direct.outbound].some((item) => item.relatedConcept === null)) warnings.push("ไม่พบรายละเอียด concept ในข้อมูล TMT ที่ซิงก์ปัจจุบัน");
  if ([...direct.inbound, ...direct.outbound].some((item) => item.concept1 === item.concept2)) warnings.push("พบ self relationship ในข้อมูล TMT");
  if (nlem?.conflict) warnings.push("พบหลายค่า NLEM ในวันที่ล่าสุด");
  if (atc?.conflict) warnings.push("พบหลายค่า ATC ในวันที่ล่าสุด");
  if (regno?.conflict) warnings.push("พบหลายเลขทะเบียนยาในวันที่ล่าสุด");

  return {
    concept,
    masterTmt: concept.level === "tpu" && concept.masterStatus !== null ? {
      activeIngredient: concept.activeIngredient,
      strength: concept.strength,
      dosageForm: concept.dosageForm,
      contentValue: concept.contentValue,
      contentUnit: concept.contentUnit,
      dispensingUnit: concept.dispensingUnit,
      tradeName: concept.tradeName,
      manufacturer: concept.manufacturer,
      status: concept.masterStatus,
    } : null,
    nlem,
    atc,
    regno,
    direct,
    graph,
    relatedTpu: related,
    warnings: [...new Set(warnings)].slice(0, 20),
  };
}
