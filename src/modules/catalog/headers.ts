/**
 * The DrugCat sheet contract. Confirmed against the approved template
 * `05957_drugcat_pass.xls`: sheet `Sheet0`, columns A:V, headers on row 1.
 * Names and order are locked — see docs/SPEC.md.
 */

export const DRUGCAT_HEADERS = [
  "#",
  "HOSPDRUGCODE",
  "PRODUCTCAT",
  "TMTID",
  "SPECPREP",
  "GENERICNAME",
  "TRADENAME",
  "DFSCODE",
  "DOSAGEFORM",
  "STRENGTH",
  "CONTENT",
  "UNITPRICE",
  "DISTRIBUTOR",
  "MANUFACTURER",
  "ISED",
  "NDC24",
  "PACKSIZE",
  "PACKPRICE",
  "UPDATEFLAG",
  "DATECHANGE",
  "DATEUPDATE",
  "DATEEFFECTIVE",
] as const;

export type DrugcatHeader = (typeof DRUGCAT_HEADERS)[number];

export const DRUGCAT_COLUMN_COUNT = DRUGCAT_HEADERS.length;

/**
 * The 21 payload fields, in sheet order. `#` is a display counter only and is
 * never treated as identity (docs/SPEC.md).
 */
export const PAYLOAD_FIELDS = [
  "hospdrugcode",
  "productcat",
  "tmtid",
  "specprep",
  "genericname",
  "tradename",
  "dfscode",
  "dosageform",
  "strength",
  "content",
  "unitprice",
  "distributor",
  "manufacturer",
  "ised",
  "ndc24",
  "packsize",
  "packprice",
  "updateflag",
  "datechange",
  "dateupdate",
  "dateeffective",
] as const;

export type PayloadField = (typeof PAYLOAD_FIELDS)[number];

/** Column index (0-based) of each payload field within the 22-column sheet. */
export const PAYLOAD_COLUMN_INDEX: Record<PayloadField, number> = PAYLOAD_FIELDS.reduce(
  (map, field, index) => {
    map[field] = index + 1; // column A is `#`
    return map;
  },
  {} as Record<PayloadField, number>,
);

export const SHEET_NAME = "Sheet0";
