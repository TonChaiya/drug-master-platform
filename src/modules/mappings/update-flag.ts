/**
 * UPDATEFLAG decision (docs/SPEC.md):
 *   A — HOSPDRUGCODE is absent from the facility's latest Drug Catalog snapshot
 *   E — it is present, and the user created or changed the mapping
 *
 * The comparison is always against the same facility's own latest snapshot;
 * comparing across facilities is explicitly forbidden.
 */

export type UpdateFlag = "A" | "E";

export function decideUpdateFlag(presentInLatestSnapshot: boolean): UpdateFlag {
  return presentInLatestSnapshot ? "E" : "A";
}

/**
 * When no snapshot has ever been imported there is nothing to compare against,
 * so every mapping is new by definition.
 */
export function decideUpdateFlagWithSnapshot(hasSnapshot: boolean, presentInLatestSnapshot: boolean): UpdateFlag {
  if (!hasSnapshot) return "A";
  return decideUpdateFlag(presentInLatestSnapshot);
}
