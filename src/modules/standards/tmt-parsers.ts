import { z } from "zod";

export class TmtResponseError extends Error {
  constructor() {
    super("TMT API response does not match the documented contract");
    this.name = "TmtResponseError";
  }
}

const identifier = z
  .union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/)])
  .transform((value) => String(value));
const requiredText = z.string().trim().min(1);
const sourceText = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  });
const dateText = z.string().trim().min(1);

function contract<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new TmtResponseError();
  return result.data;
}

function dataRows<T>(schema: z.ZodType<T>, value: unknown): T[] {
  return contract(z.object({ data: z.array(schema) }).transform((root) => root.data), value);
}

function simpleRecord<TId extends string>(id: TId) {
  return z.object({ [id]: identifier, fsn: requiredText, change_date: dateText }).transform((row) => ({
    [id]: row[id],
    fsn: row.fsn,
    changeDate: row.change_date,
  })) as z.ZodType<Record<TId, string> & { fsn: string; changeDate: string }>;
}

function tradeRecord<TId extends string>(id: TId) {
  return z.object({ [id]: identifier, fsn: requiredText, manufacturer: requiredText, change_date: dateText }).transform((row) => ({
    [id]: row[id],
    fsn: row.fsn,
    manufacturer: row.manufacturer,
    changeDate: row.change_date,
  })) as z.ZodType<Record<TId, string> & { fsn: string; manufacturer: string; changeDate: string }>;
}

export interface TokenResult {
  success: string;
  create: string;
  expire: string;
  token: string;
}

export function parseTokenResponse(value: unknown): TokenResult {
  return contract(z.object({ success: requiredText, create: requiredText, expire: requiredText, token: requiredText }), value);
}

export interface SubsRecord { subsid: string; fsn: string; changeDate: string }
export interface VtmRecord { vtmid: string; fsn: string; changeDate: string }
export interface GpRecord { gpid: string; fsn: string; changeDate: string }
export interface GpuRecord { gpuid: string; fsn: string; changeDate: string }
export interface GppRecord { gppid: string; fsn: string; changeDate: string }
export interface TpRecord { tpid: string; fsn: string; manufacturer: string; changeDate: string }
export interface TpuRecord { tpuid: string; fsn: string; manufacturer: string; changeDate: string }
export interface TppRecord { tppid: string; fsn: string; manufacturer: string; changeDate: string }
export interface ImageListRecord { tpuid: string; fsn: string; changeDate: string }

export const parseSubsResponse = (value: unknown): SubsRecord[] => dataRows(simpleRecord("subsid"), value);
export const parseVtmResponse = (value: unknown): VtmRecord[] => dataRows(simpleRecord("vtmid"), value);
export const parseGpResponse = (value: unknown): GpRecord[] => dataRows(simpleRecord("gpid"), value);
export const parseGpuResponse = (value: unknown): GpuRecord[] => dataRows(simpleRecord("gpuid"), value);
export const parseGppResponse = (value: unknown): GppRecord[] => dataRows(simpleRecord("gppid"), value);
export const parseTpResponse = (value: unknown): TpRecord[] => dataRows(tradeRecord("tpid"), value);
export const parseTpuResponse = (value: unknown): TpuRecord[] => dataRows(tradeRecord("tpuid"), value);
export const parseTppResponse = (value: unknown): TppRecord[] => dataRows(tradeRecord("tppid"), value);
export const parseImageListResponse = (value: unknown): ImageListRecord[] => dataRows(simpleRecord("tpuid"), value);

export interface ImagePackageRecord {
  tppid: string;
  fsn: string | null;
  images: Record<string, string | null>;
}

export interface ImageRecord {
  tpuid: string;
  fsn: string | null;
  pill: string | null;
  pills: string | null;
  packages: ImagePackageRecord[];
}

const imageValue = z.union([z.string(), z.null()]).transform((value) => {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
});
const imagePackage = z.object({ tppid: identifier, fsn: sourceText }).catchall(imageValue);
const imageRow = z
  .object({
    tpuid: identifier,
    fsn: sourceText,
    pill: sourceText,
    pills: sourceText,
    packages: z.array(imagePackage).optional(),
    package: z.array(imagePackage).optional(),
    packs: z.array(imagePackage).optional(),
  })
  .transform((row) => ({
    tpuid: row.tpuid,
    fsn: row.fsn,
    pill: row.pill,
    pills: row.pills,
    packages: (row.packages ?? row.package ?? row.packs ?? []).map((entry) => {
      const images = Object.fromEntries(
        Object.entries(entry)
          .filter(([key]) => key !== "tppid" && key !== "fsn")
          .map(([key, image]) => [key, image as string | null]),
      );
      return { tppid: entry.tppid, fsn: entry.fsn, images };
    }),
  }));

export function parseImageResponse(value: unknown): ImageRecord[] {
  return dataRows(imageRow, value);
}

export interface NlemRecord { tpuid: string; fsn: string; nlem: string; changeDate: string }
export interface AtcRecord { tpuid: string; fsn: string; atc: string; changeDate: string }
export interface RegnoRecord { tpuid: string; fsn: string; regno: string; changeDate: string }

const nlemRecord = z.object({ tpuid: identifier, fsn: requiredText, nlem: z.string().trim(), change_date: dateText }).transform((row) => ({
  tpuid: row.tpuid, fsn: row.fsn, nlem: row.nlem, changeDate: row.change_date,
}));
const atcRecord = z.object({ tpuid: identifier, fsn: requiredText, atc: z.string().trim(), change_date: dateText }).transform((row) => ({
  tpuid: row.tpuid, fsn: row.fsn, atc: row.atc, changeDate: row.change_date,
}));
const regnoRecord = z.object({ tpuid: identifier, fsn: requiredText, regno: z.string().trim(), change_date: dateText }).transform((row) => ({
  tpuid: row.tpuid, fsn: row.fsn, regno: row.regno, changeDate: row.change_date,
}));

export const parseNlemResponse = (value: unknown): NlemRecord[] => dataRows(nlemRecord, value);
export const parseAtcResponse = (value: unknown): AtcRecord[] => dataRows(atcRecord, value);
export const parseRegnoResponse = (value: unknown): RegnoRecord[] => dataRows(regnoRecord, value);

export interface MasterTmtRecord {
  tpucode: string;
  activeingredient: string | null;
  strength: string | null;
  dosageform: string | null;
  contvalue: string | null;
  contunit: string | null;
  dispunit: string | null;
  tradename: string | null;
  manufacturer: string | null;
  fsn: string | null;
  status: 0 | 1;
}

const masterTmt = z.object({
  tpucode: identifier,
  activeingredient: sourceText,
  strength: sourceText,
  dosageform: sourceText,
  contvalue: sourceText,
  contunit: sourceText,
  dispunit: sourceText,
  tradename: sourceText,
  manufacturer: sourceText,
  fsn: sourceText,
  status: z.union([z.literal(0), z.literal(1)]),
});

export function parseMasterTmtResponse(value: unknown): MasterTmtRecord[] {
  return dataRows(masterTmt, value);
}

export interface ConceptRecord { tmtid: string; fsn: string; changeDate: string; levelName: string }
const concept = z.object({ tmtid: identifier, fsn: requiredText, change_date: dateText, level_name: requiredText }).transform((row) => ({
  tmtid: row.tmtid,
  fsn: row.fsn,
  changeDate: row.change_date,
  levelName: row.level_name,
}));

export function parseConceptResponse(value: unknown): ConceptRecord[] {
  return dataRows(concept, value);
}

export interface RelationshipRecord {
  concept1: string;
  concept2: string;
  changeDate: string;
  levelName1: string;
  levelName2: string;
}
const relationship = z.object({
  concept1: identifier,
  concept2: identifier,
  change_date: dateText,
  level_name1: requiredText,
  level_name2: requiredText,
}).transform((row) => ({
  concept1: row.concept1,
  concept2: row.concept2,
  changeDate: row.change_date,
  levelName1: row.level_name1,
  levelName2: row.level_name2,
}));

export function parseRelationshipResponse(value: unknown): RelationshipRecord[] {
  return dataRows(relationship, value);
}

export interface TmtVersionPayload { tmtVersion: string }

export function parseVersionResponse(value: unknown): TmtVersionPayload {
  return contract(
    z.object({ success: requiredText, tmt_version: z.string().trim().regex(/^\d{8}$/) }).transform((root) => ({ tmtVersion: root.tmt_version })),
    value,
  );
}
