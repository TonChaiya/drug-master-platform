export const OFFICE_ID_PATTERN = /^\d{5}$/;

export function isValidOfficeId(value: string): boolean {
  return OFFICE_ID_PATTERN.test(value) && !value.startsWith("0000");
}

/**
 * The facility name typed at signup is a confirmation that the 5-digit code is
 * the right one, not the source of truth — the stored name always wins. So the
 * comparison ignores spacing and case: "รพ.สต. ทดสอบ เอ" and "รพ.สต.ทดสอบ เอ"
 * are the same place, and rejecting the second one only taught people that
 * joining their own colleagues was impossible. A genuinely wrong code still
 * fails, because its registered name is nothing like what was typed.
 */
export function normalizeFacilityName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("th-TH");
}
