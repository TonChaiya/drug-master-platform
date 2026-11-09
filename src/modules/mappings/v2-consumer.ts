import { and, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db/client";
import { tmtConcept, tmtMastertmt, tmtNlem, tmtRegno, ttmtImports, ttmtProducts } from "@/db/schema";
import { normalizeNlem } from "./ised";
import { evaluateMappingV2Standard, type MappingStandardSource } from "./v2";

export interface MappingV2Identity {
  source: MappingStandardSource;
  code: string;
  level: string;
  productCat: string;
}

export interface TemporalValues {
  changeDate: string;
  values: string[];
}

interface ProductFields {
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: string | null;
  contentValue: string | null;
  contentUnit: string | null;
  dispensingUnit: string | null;
  tradeName: string | null;
  manufacturer: string | null;
  fsn: string | null;
  sourceVersion: string;
}

export type MappingV2ConsumerInput =
  | {
      identity: MappingV2Identity & { source: "TMT" };
      concept: { level: string; fsn: string; sourceVersion: string } | null;
      master: ProductFields & { status: number } | null;
      nlem: TemporalValues | null;
      regno: TemporalValues | null;
    }
  | {
      identity: MappingV2Identity & { source: "TTMT" };
      product: ProductFields & {
        status: string;
        nlem: string | null;
        registrationNumber: string | null;
        importStatus: string;
      } | null;
    };

export interface ResolvedMappedStandardV2 {
  source: MappingStandardSource;
  code: string;
  level: string;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: string | null;
  contentValue: string | null;
  contentUnit: string | null;
  dispensingUnit: string | null;
  tradeName: string | null;
  manufacturer: string | null;
  fsn: string | null;
  rawStatus: string | number | null;
  active: boolean;
  eligible: boolean;
  reason: string | null;
  rawNlem: string | null;
  exportIsed: string | null;
  registrationNumber: string | null;
  sourceVersion: string | null;
  warnings: string[];
  conflicts: Array<"nlem" | "regno">;
}

const emptyFields = {
  activeIngredient: null,
  strength: null,
  dosageForm: null,
  contentValue: null,
  contentUnit: null,
  dispensingUnit: null,
  tradeName: null,
  manufacturer: null,
  fsn: null,
} as const;

function oneOrConflict(values: TemporalValues | null): { value: string | null; conflict: boolean } {
  const distinct = [...new Set(values?.values.map((value) => value.trim()).filter(Boolean) ?? [])].sort();
  return { value: distinct.length === 1 ? distinct[0]! : null, conflict: distinct.length > 1 };
}

/** Pure source-aware adapter used by DB batch resolution and targeted tests. */
export function resolveMappedStandardV2(input: MappingV2ConsumerInput): ResolvedMappedStandardV2 {
  if ("concept" in input) {
    const evaluation = evaluateMappingV2Standard({
      ...input.identity,
      exists: Boolean(input.concept),
      conceptLevel: input.concept?.level,
      masterStatus: input.master?.status ?? null,
    });
    const nlem = oneOrConflict(input.nlem);
    const regno = oneOrConflict(input.regno);
    const normalized = normalizeNlem(nlem.value);
    const warnings: string[] = [];
    const conflicts: Array<"nlem" | "regno"> = [];
    if (nlem.conflict) {
      conflicts.push("nlem");
      warnings.push("พบหลายค่า NLEM ในวันที่ล่าสุด จึงเว้น ISED ว่างไว้");
    } else if (normalized.warning) warnings.push(normalized.warning);
    if (regno.conflict) {
      conflicts.push("regno");
      warnings.push("พบหลายเลขทะเบียนยาในวันที่ล่าสุด จึงไม่เลือกค่าใดโดยพลการ");
    }
    return {
      source: "TMT",
      code: input.identity.code,
      level: input.identity.level,
      ...(input.master ?? emptyFields),
      fsn: input.master?.fsn ?? input.concept?.fsn ?? null,
      rawStatus: input.master?.status ?? null,
      active: input.master?.status === 0,
      ...evaluation,
      rawNlem: nlem.conflict ? null : normalized.raw,
      exportIsed: nlem.conflict ? null : normalized.exportValue,
      registrationNumber: regno.value,
      sourceVersion: input.master?.sourceVersion ?? input.concept?.sourceVersion ?? null,
      warnings,
      conflicts,
    };
  }

  const evaluation = evaluateMappingV2Standard({
    ...input.identity,
    exists: Boolean(input.product),
    ttmtStatus: input.product?.status,
    importSucceeded: input.product ? input.product.importStatus === "succeeded" : null,
  });
  const normalized = normalizeNlem(input.product?.nlem);
  return {
    source: "TTMT",
    code: input.identity.code,
    level: input.identity.level,
    ...(input.product ?? emptyFields),
    rawStatus: input.product?.status ?? null,
    active: input.product?.status === "active",
    ...evaluation,
    rawNlem: normalized.raw,
    exportIsed: normalized.exportValue,
    registrationNumber: input.product?.registrationNumber ?? null,
    sourceVersion: input.product?.sourceVersion ?? null,
    warnings: normalized.warning ? [normalized.warning] : [],
    conflicts: [],
  };
}

export function mappingV2IdentityKey(identity: Pick<MappingV2Identity, "source" | "code" | "level">): string {
  return `${identity.source}\u0000${identity.code}\u0000${identity.level}`;
}

type V2ConsumerDb = Pick<typeof db, "select">;

function temporalMap<T extends { tpuid: bigint; changeDate: string; value: string }>(rows: T[]): Map<string, TemporalValues> {
  const grouped = new Map<string, TemporalValues>();
  for (const row of rows) {
    const code = row.tpuid.toString();
    const entry = grouped.get(code) ?? { changeDate: row.changeDate, values: [] };
    entry.values.push(row.value);
    grouped.set(code, entry);
  }
  for (const entry of grouped.values()) entry.values = [...new Set(entry.values)].sort();
  return grouped;
}

/** Bounded batch loader: base TMT, latest NLEM, latest RegNo, and TTMT are loaded once per export/reconcile batch. */
export async function loadMappedStandardsV2(
  identities: MappingV2Identity[],
  database: V2ConsumerDb = db,
): Promise<Map<string, ResolvedMappedStandardV2>> {
  const tmtCodes = [...new Set(identities.filter((item) => item.source === "TMT").map((item) => item.code))]
    .map((code) => { try { return BigInt(code); } catch { return null; } })
    .filter((code): code is bigint => code !== null && code >= 0n);
  const ttmtCodes = [...new Set(identities.filter((item) => item.source === "TTMT").map((item) => item.code))];

  const latestNlemDates = database
    .select({ tpuid: tmtNlem.tpuid, changeDate: max(tmtNlem.changeDate).as("latest_change_date") })
    .from(tmtNlem)
    .where(tmtCodes.length ? inArray(tmtNlem.tpuid, tmtCodes) : eq(tmtNlem.tpuid, -1n))
    .groupBy(tmtNlem.tpuid)
    .as("latest_consumer_nlem");
  const latestRegnoDates = database
    .select({ tpuid: tmtRegno.tpuid, changeDate: max(tmtRegno.changeDate).as("latest_change_date") })
    .from(tmtRegno)
    .where(tmtCodes.length ? inArray(tmtRegno.tpuid, tmtCodes) : eq(tmtRegno.tpuid, -1n))
    .groupBy(tmtRegno.tpuid)
    .as("latest_consumer_regno");

  const [tmtRows, nlemRows, regnoRows, ttmtRows] = await Promise.all([
    tmtCodes.length
      ? database
          .select({
            code: tmtConcept.tmtid,
            conceptLevel: tmtConcept.levelName,
            conceptFsn: tmtConcept.fsn,
            conceptVersion: tmtConcept.sourceVersion,
            activeIngredient: tmtMastertmt.activeingredient,
            strength: tmtMastertmt.strength,
            dosageForm: tmtMastertmt.dosageform,
            contentValue: tmtMastertmt.contvalue,
            contentUnit: tmtMastertmt.contunit,
            dispensingUnit: tmtMastertmt.dispunit,
            tradeName: tmtMastertmt.tradename,
            manufacturer: tmtMastertmt.manufacturer,
            masterFsn: tmtMastertmt.fsn,
            masterStatus: tmtMastertmt.status,
            masterVersion: tmtMastertmt.sourceVersion,
          })
          .from(tmtConcept)
          .leftJoin(tmtMastertmt, eq(tmtMastertmt.tpucode, tmtConcept.tmtid))
          .where(inArray(tmtConcept.tmtid, tmtCodes))
      : Promise.resolve([]),
    tmtCodes.length
      ? database
          .select({ tpuid: tmtNlem.tpuid, changeDate: tmtNlem.changeDate, value: tmtNlem.nlem })
          .from(tmtNlem)
          .innerJoin(latestNlemDates, and(eq(latestNlemDates.tpuid, tmtNlem.tpuid), eq(latestNlemDates.changeDate, tmtNlem.changeDate)))
      : Promise.resolve([]),
    tmtCodes.length
      ? database
          .select({ tpuid: tmtRegno.tpuid, changeDate: tmtRegno.changeDate, value: tmtRegno.regno })
          .from(tmtRegno)
          .innerJoin(latestRegnoDates, and(eq(latestRegnoDates.tpuid, tmtRegno.tpuid), eq(latestRegnoDates.changeDate, tmtRegno.changeDate)))
      : Promise.resolve([]),
    ttmtCodes.length
      ? database
          .select({
            code: ttmtProducts.ttmtcode,
            activeIngredient: ttmtProducts.activeingredient,
            strength: ttmtProducts.strength,
            dosageForm: ttmtProducts.dosageform,
            contentValue: ttmtProducts.contvalue,
            contentUnit: ttmtProducts.contunit,
            dispensingUnit: ttmtProducts.dispunit,
            tradeName: ttmtProducts.tradename,
            manufacturer: ttmtProducts.manufacturer,
            fsn: ttmtProducts.fsn,
            status: ttmtProducts.status,
            nlem: ttmtProducts.nlem,
            registrationNumber: ttmtProducts.registrationNumber,
            sourceVersion: ttmtProducts.sourceVersion,
            importStatus: ttmtImports.status,
          })
          .from(ttmtProducts)
          .innerJoin(ttmtImports, eq(ttmtImports.id, ttmtProducts.sourceImportId))
          .where(inArray(ttmtProducts.ttmtcode, ttmtCodes))
      : Promise.resolve([]),
  ]);

  const tmtByCode = new Map(tmtRows.map((row) => [row.code.toString(), row]));
  const nlemByCode = temporalMap(nlemRows);
  const regnoByCode = temporalMap(regnoRows);
  const ttmtByCode = new Map(ttmtRows.map((row) => [row.code, row]));
  const resolved = new Map<string, ResolvedMappedStandardV2>();
  for (const identity of identities) {
    if (identity.source === "TMT") {
      const row = tmtByCode.get(identity.code);
      resolved.set(mappingV2IdentityKey(identity), resolveMappedStandardV2({
        identity: { ...identity, source: "TMT" },
        concept: row ? { level: row.conceptLevel, fsn: row.conceptFsn, sourceVersion: row.conceptVersion } : null,
        master: row?.masterStatus === null || row?.masterStatus === undefined ? null : {
          activeIngredient: row.activeIngredient, strength: row.strength, dosageForm: row.dosageForm,
          contentValue: row.contentValue, contentUnit: row.contentUnit, dispensingUnit: row.dispensingUnit,
          tradeName: row.tradeName, manufacturer: row.manufacturer, fsn: row.masterFsn,
          status: row.masterStatus, sourceVersion: row.masterVersion ?? row.conceptVersion,
        },
        nlem: nlemByCode.get(identity.code) ?? null,
        regno: regnoByCode.get(identity.code) ?? null,
      }));
    } else {
      const row = ttmtByCode.get(identity.code);
      resolved.set(mappingV2IdentityKey(identity), resolveMappedStandardV2({
        identity: { ...identity, source: "TTMT" },
        product: row ? {
          activeIngredient: row.activeIngredient, strength: row.strength, dosageForm: row.dosageForm,
          contentValue: row.contentValue, contentUnit: row.contentUnit, dispensingUnit: row.dispensingUnit,
          tradeName: row.tradeName, manufacturer: row.manufacturer, fsn: row.fsn, status: row.status,
          nlem: row.nlem, registrationNumber: row.registrationNumber, sourceVersion: row.sourceVersion,
          importStatus: row.importStatus,
        } : null,
      }));
    }
  }
  return resolved;
}
