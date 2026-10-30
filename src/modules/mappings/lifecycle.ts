export type MappingLifecycleStatus = "pending" | "needs_review" | "mapped" | "hidden";

export interface MappingLifecycleInput {
  active: boolean;
  mapping: { source: string; standardCode: string; updatedAt?: Date } | null;
  inLatestCatalog: boolean;
  latestCatalogTmtid: string | null;
  everInCatalog: boolean;
  reviewAcknowledgement?: {
    mappingUpdatedAt: Date;
    catalogPresent: boolean;
    catalogTmtid: string | null;
  } | null;
}

export type CatalogReconcileDecision =
  | { action: "noop" }
  | { action: "create" | "update"; standardCode: string }
  | { action: "needs_review" };

export function classifyMappingLifecycle(_input: MappingLifecycleInput): {
  status: MappingLifecycleStatus;
  reason: string | null;
} {
  const input = _input;
  if (!input.active) return { status: "hidden", reason: null };
  const acknowledgementMatches =
    input.mapping?.updatedAt !== undefined &&
    input.reviewAcknowledgement !== null &&
    input.reviewAcknowledgement !== undefined &&
    input.mapping.updatedAt.getTime() === input.reviewAcknowledgement.mappingUpdatedAt.getTime() &&
    input.inLatestCatalog === input.reviewAcknowledgement.catalogPresent &&
    input.latestCatalogTmtid === input.reviewAcknowledgement.catalogTmtid;
  if (!input.inLatestCatalog && input.everInCatalog) {
    return acknowledgementMatches
      ? { status: "mapped", reason: null }
      : { status: "needs_review", reason: "รหัสนี้หายจาก Drug Catalog ล่าสุด" };
  }
  if (!input.mapping) return { status: "pending", reason: null };
  if (input.inLatestCatalog && !input.latestCatalogTmtid) {
    return acknowledgementMatches
      ? { status: "mapped", reason: null }
      : { status: "needs_review", reason: "Drug Catalog ล่าสุดไม่มีรหัส TMT/TTMT" };
  }
  if (input.latestCatalogTmtid && input.latestCatalogTmtid !== input.mapping.standardCode) {
    if (acknowledgementMatches) return { status: "mapped", reason: null };
    return {
      status: "needs_review",
      reason:
        input.mapping.source === "manual"
          ? "TMT/TTMT ใน Drug Catalog เปลี่ยน แต่รายการนี้ถูกแก้แบบ manual"
          : "TMT/TTMT ใน Drug Catalog เปลี่ยน กรุณาจับคู่อัตโนมัติจาก snapshot ล่าสุด",
    };
  }
  return { status: "mapped", reason: null };
}

export function decideCatalogReconcile(_input: MappingLifecycleInput): CatalogReconcileDecision {
  const input = _input;
  if (!input.active) return { action: "noop" };
  if (!input.inLatestCatalog) return input.everInCatalog ? { action: "needs_review" } : { action: "noop" };
  if (!input.latestCatalogTmtid) return input.mapping ? { action: "needs_review" } : { action: "noop" };
  if (!input.mapping) return { action: "create", standardCode: input.latestCatalogTmtid };
  if (input.mapping.standardCode === input.latestCatalogTmtid) return { action: "noop" };
  if (input.mapping.source === "drug_catalog") return { action: "update", standardCode: input.latestCatalogTmtid };
  return { action: "needs_review" };
}
