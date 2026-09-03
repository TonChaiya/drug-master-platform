import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { drugMappings, sourceDrugs, standardProducts } from "@/db/schema";

export type ExportSelection = "all-mapped" | "manual-changes";

/** One export row, already resolved to the values that go on the sheet. */
export interface ExportRow {
  hospdrugcode: string;
  productcat: string;
  tmtid: string;
  specprep: string;
  genericname: string;
  tradename: string;
  dfscode: string;
  dosageform: string;
  strength: string;
  content: string;
  unitprice: string;
  distributor: string;
  manufacturer: string;
  ised: string;
  ndc24: string;
  packsize: string;
  packprice: string;
  updateflag: string;
  datechange: string | null;
  dateupdate: string | null;
  dateeffective: string | null;
}

function text(value: string | null | undefined): string {
  return value?.toString().trim() ?? "";
}

/**
 * CONTENT is the pack description, not the dispensing unit alone.
 *
 * Checked against an approved DrugCat file: "1 mL ampoule" is contvalue "1" +
 * contunit "mL" + dispunit "ampoule", and a product with no content value is
 * just its dispensing unit ("tablet"). Emitting dispunit on its own dropped the
 * pack size from every injectable.
 */
function contentText(contentValue: string | null, contentUnit: string | null, dispensingUnit: string | null): string {
  return [contentValue, contentUnit, dispensingUnit].map(text).filter((part) => part !== "").join(" ");
}

/**
 * Builds the export set for a facility.
 *
 * Field sources follow docs/SPEC.md: GENERICNAME from the standard's
 * activeIngredient, TRADENAME from its tradeName, ISED from the normalised NLEM
 * value stored on the standard.
 *
 * Columns with no source stay empty rather than being filled from something
 * that merely looks similar. SPECPREP, DFSCODE and PACKSIZE have no TMT field
 * and are blank in the approved DrugCat files, so they carry only what a user
 * typed on the mapping screen. UNITPRICE and NDC24 do fall back to JHCIS,
 * because price and the hospital NDC24 are local facts TMT never carries and
 * the approved files do fill them.
 */
export async function buildExportRows(facilityId: string, selection: ExportSelection): Promise<ExportRow[]> {
  const conditions = [eq(drugMappings.facilityId, facilityId), eq(sourceDrugs.active, 1)];
  if (selection === "manual-changes") conditions.push(eq(drugMappings.source, "manual"));

  const rows = await db
    .select({
      drugcode: sourceDrugs.drugcode,
      sell: sourceDrugs.sell,
      drugcode24: sourceDrugs.drugcode24,
      standardCode: drugMappings.standardCode,
      productCat: drugMappings.productCat,
      specPrep: drugMappings.specPrep,
      dfscode: drugMappings.dfscode,
      unitPrice: drugMappings.unitPrice,
      distributor: drugMappings.distributor,
      mappingIsed: drugMappings.ised,
      ndc24: drugMappings.ndc24,
      packsize: drugMappings.packsize,
      packPrice: drugMappings.packPrice,
      updateFlag: drugMappings.updateFlag,
      dateChange: drugMappings.dateChange,
      dateUpdate: drugMappings.dateUpdate,
      dateEffective: drugMappings.dateEffective,
      activeIngredient: standardProducts.activeIngredient,
      tradeName: standardProducts.tradeName,
      dosageForm: standardProducts.dosageForm,
      strength: standardProducts.strength,
      contentValue: standardProducts.contentValue,
      contentUnit: standardProducts.contentUnit,
      dispensingUnit: standardProducts.dispensingUnit,
      manufacturer: standardProducts.manufacturer,
      standardIsed: standardProducts.exportIsed,
    })
    .from(drugMappings)
    .innerJoin(sourceDrugs, eq(sourceDrugs.id, drugMappings.sourceDrugId))
    .leftJoin(standardProducts, eq(standardProducts.standardCode, drugMappings.standardCode))
    .where(and(...conditions))
    .orderBy(asc(sourceDrugs.drugcode));

  return rows.map((row) => ({
    hospdrugcode: text(row.drugcode),
    productcat: text(row.productCat),
    tmtid: text(row.standardCode),
    specprep: text(row.specPrep),
    genericname: text(row.activeIngredient),
    tradename: text(row.tradeName),
    dfscode: text(row.dfscode),
    dosageform: text(row.dosageForm),
    strength: text(row.strength),
    content: contentText(row.contentValue, row.contentUnit, row.dispensingUnit),
    unitprice: text(row.unitPrice) || text(row.sell),
    distributor: text(row.distributor),
    manufacturer: text(row.manufacturer),
    // Prefer the mapping's stored ISED; fall back to the standard's current value.
    ised: text(row.mappingIsed) || text(row.standardIsed),
    ndc24: text(row.ndc24) || text(row.drugcode24),
    packsize: text(row.packsize),
    packprice: text(row.packPrice),
    updateflag: text(row.updateFlag),
    datechange: row.dateChange,
    dateupdate: row.dateUpdate,
    dateeffective: row.dateEffective,
  }));
}
