export const OFFICE_ID_PATTERN = /^\d{5}$/;

export function isValidOfficeId(value: string): boolean {
  return OFFICE_ID_PATTERN.test(value) && !value.startsWith("0000");
}
