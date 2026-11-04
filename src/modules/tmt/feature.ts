type EnvLike = Record<string, string | undefined>;

export function tmtV2BrowserEnabled(env: EnvLike = process.env): boolean {
  return env.TMT_V2_BROWSER_ENABLED === "1";
}
