type EnvLike = Record<string, string | undefined>;

export function tmtV2BrowserEnabled(env: EnvLike = process.env): boolean {
  return env.TMT_V2_BROWSER_ENABLED === "1";
}

/** Mapping v2 is separately gated because it adds columns after Browser v2. */
export function tmtV2MappingEnabled(env: EnvLike = process.env): boolean {
  return env.TMT_V2_MAPPING_ENABLED === "1";
}
