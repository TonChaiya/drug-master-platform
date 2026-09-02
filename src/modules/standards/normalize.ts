/**
 * Search normalisation for the standard catalogue.
 *
 * docs/OPERATIONS.md rules out FULLTEXT (its availability varies by TiDB
 * region and plan), so search runs against pre-normalised columns with ordinary
 * indexes instead.
 */

export function normalizeSearchText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .trim();
  return normalized === "" ? null : normalized.slice(0, 255);
}

/** Registration numbers are compared without punctuation or spacing. */
export function normalizeRegistrationNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9฀-๿]/g, "");
  return normalized === "" ? null : normalized.slice(0, 160);
}

/** MasterTMT status: 0 = active, 1 = inactive (docs/SPEC.md). */
export function standardStatusFromApi(status: unknown): "active" | "inactive" {
  const value = String(status ?? "").trim();
  return value === "0" ? "active" : "inactive";
}
