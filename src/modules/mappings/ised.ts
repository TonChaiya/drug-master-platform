/**
 * ISED normalisation. The value comes from `/nlem.nlem` only — never guessed
 * from anything else (docs/SPEC.md).
 *
 *   ED   -> E
 *   ED*  -> E*
 *   NED  -> N
 *
 * Anything else keeps the raw value, exports an empty ISED, and raises a
 * data-quality warning rather than inventing a code.
 */

export interface IsedNormalization {
  raw: string | null;
  exportValue: string | null;
  warning: string | null;
}

export function normalizeNlem(raw: string | null | undefined): IsedNormalization {
  const value = (raw ?? "").trim().toUpperCase();
  if (value === "") return { raw: null, exportValue: null, warning: null };
  if (value === "ED") return { raw: value, exportValue: "E", warning: null };
  if (value === "ED*") return { raw: value, exportValue: "E*", warning: null };
  if (value === "NED") return { raw: value, exportValue: "N", warning: null };
  return {
    raw: value,
    exportValue: null,
    warning: `ค่า NLEM "${value}" ไม่อยู่ในรายการที่กำหนด จึงเว้น ISED ว่างไว้`,
  };
}
