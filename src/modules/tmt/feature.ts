type EnvLike = Record<string, string | undefined>;

export function tmtV2BrowserEnabled(env: EnvLike = process.env): boolean {
  return env.TMT_V2_BROWSER_ENABLED === "1";
}

/** Mapping v2 is separately gated because it adds columns after Browser v2. */
export function tmtV2MappingEnabled(env: EnvLike = process.env): boolean {
  return env.TMT_V2_MAPPING_ENABLED === "1";
}

/** Catalog reconciliation is isolated from the browser/mapping rollout. */
export function tmtV2CatalogEnabled(env: EnvLike = process.env): boolean {
  return env.TMT_V2_CATALOG_ENABLED === "1";
}

/** Export v2 remains opt-in until migrations and the Phase 7 cutover are approved. */
export function tmtV2ExportEnabled(env: EnvLike = process.env): boolean {
  return env.TMT_V2_EXPORT_ENABLED === "1";
}
