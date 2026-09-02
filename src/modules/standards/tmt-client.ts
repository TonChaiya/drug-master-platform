/**
 * TMT API adapter.
 *
 * Credentials are server-only and never appear in any returned value or error
 * message. Token responses are cached in memory for the life of the process —
 * docs/SPEC.md forbids writing them to the function filesystem.
 */

export interface TmtVersionResult {
  ok: boolean;
  tmtVersion: string | null;
  httpStatus: number | null;
  latencyMs: number;
  errorCode: string | null;
  message: string;
}

type FetchLike = typeof fetch;

class RemoteResponseError extends Error {
  constructor(
    readonly status: number,
    readonly stage: string,
  ) {
    super(`TMT ${stage} returned HTTP ${status}`);
  }
}

class InvalidJsonError extends Error {}
class InvalidResponseError extends Error {}

export class TmtApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TmtApiError";
  }
}

function resultError(startedAt: number, error: unknown): TmtVersionResult {
  const latencyMs = Math.max(0, Date.now() - startedAt);
  if (error instanceof RemoteResponseError) {
    if (error.status === 401 || error.status === 403) {
      return { ok: false, tmtVersion: null, httpStatus: error.status, latencyMs, errorCode: "TMT_AUTH", message: "TMT API ปฏิเสธ credential" };
    }
    if (error.status >= 500) {
      return { ok: false, tmtVersion: null, httpStatus: error.status, latencyMs, errorCode: "TMT_REMOTE_5XX", message: "TMT API ขัดข้องชั่วคราว" };
    }
    return { ok: false, tmtVersion: null, httpStatus: error.status, latencyMs, errorCode: "TMT_REMOTE_HTTP", message: "TMT API ตอบกลับด้วยสถานะที่ไม่สำเร็จ" };
  }
  if (error instanceof InvalidJsonError) {
    return { ok: false, tmtVersion: null, httpStatus: null, latencyMs, errorCode: "TMT_INVALID_JSON", message: "TMT API ส่ง JSON ที่อ่านไม่ได้" };
  }
  if (error instanceof InvalidResponseError) {
    return { ok: false, tmtVersion: null, httpStatus: null, latencyMs, errorCode: "TMT_INVALID_RESPONSE", message: "TMT API ส่งข้อมูลไม่ครบตามรูปแบบ" };
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return { ok: false, tmtVersion: null, httpStatus: null, latencyMs, errorCode: "TMT_TIMEOUT", message: "TMT API ตอบกลับเกินเวลาที่กำหนด" };
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("certificate") || message.includes("tls") || message.includes("ssl")) {
    return { ok: false, tmtVersion: null, httpStatus: null, latencyMs, errorCode: "TMT_TLS", message: "ตรวจสอบ TLS certificate ของ TMT API ไม่สำเร็จ" };
  }
  if (message.includes("socket") || message.includes("disconnect") || message.includes("reset")) {
    return { ok: false, tmtVersion: null, httpStatus: null, latencyMs, errorCode: "TMT_DISCONNECTED", message: "TMT API ตัดการเชื่อมต่อ" };
  }
  return { ok: false, tmtVersion: null, httpStatus: null, latencyMs, errorCode: "TMT_NETWORK", message: "เชื่อมต่อ TMT API ไม่สำเร็จ" };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new InvalidJsonError();
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidResponseError();
  return value as Record<string, unknown>;
}

function apiBase(): string {
  return process.env.TMT_API_BASE?.trim().replace(/\/$/, "") || "https://tmt.this.or.th/tmtapi";
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

/** Clears the in-memory token cache. Exposed for tests. */
export function resetTmtTokenCache(): void {
  cachedToken = null;
}

async function fetchToken(fetcher: FetchLike): Promise<string> {
  const username = process.env.TMT_API_USER?.trim();
  const password = process.env.TMT_API_PASSWORD;
  if (!username || !password) throw new TmtApiError("TMT_CONFIG_MISSING", "ยังไม่ได้ตั้งค่า TMT credential ฝั่ง server");

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const response = await fetcher(`${apiBase()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new RemoteResponseError(response.status, "token");
  const body = objectValue(await readJson(response));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) throw new InvalidResponseError();

  const expiry = typeof body.expire === "string" ? Date.parse(body.expire) : Number.NaN;
  cachedToken = {
    token,
    expiresAt: Number.isFinite(expiry) ? expiry : Date.now() + 30 * 60_000,
  };
  return token;
}

async function callEndpoint(path: string, payload: Record<string, unknown>, fetcher: FetchLike): Promise<Record<string, unknown>> {
  const token = await fetchToken(fetcher);
  const response = await fetcher(`${apiBase()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // The manual specifies the raw token, not a URL-encoded one.
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status === 401 || response.status === 403) {
    // Token may have expired early; drop it so the next attempt re-authenticates.
    cachedToken = null;
  }
  if (!response.ok) throw new RemoteResponseError(response.status, path);
  return objectValue(await readJson(response));
}

function rows(body: Record<string, unknown>, ...keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const value = body[key];
    if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }
  return [];
}

export async function fetchTmtVersion(fetcher: FetchLike = fetch): Promise<TmtVersionResult> {
  const startedAt = Date.now();
  try {
    const body = await callEndpoint("/version", {}, fetcher);
    const tmtVersion = typeof body.tmt_version === "string" ? body.tmt_version.trim() : "";
    if (!/^\d{8}$/.test(tmtVersion)) throw new InvalidResponseError();
    return {
      ok: true,
      tmtVersion,
      httpStatus: 200,
      latencyMs: Math.max(0, Date.now() - startedAt),
      errorCode: null,
      message: "เชื่อมต่อ TMT API สำเร็จ",
    };
  } catch (error) {
    if (error instanceof TmtApiError) {
      return { ok: false, tmtVersion: null, httpStatus: null, latencyMs: 0, errorCode: error.code, message: error.message };
    }
    return resultError(startedAt, error);
  }
}

export interface MasterTmtRecord {
  tpucode: string;
  activeingredient: string | null;
  strength: string | null;
  dosageform: string | null;
  contvalue: string | null;
  contunit: string | null;
  dispunit: string | null;
  tradename: string | null;
  manufacturer: string | null;
  fsn: string | null;
  status: string | null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

export async function fetchMasterTmt(window: { begindate: string; enddate: string }, fetcher: FetchLike = fetch): Promise<MasterTmtRecord[]> {
  const body = await callEndpoint("/mastertmt", window, fetcher);
  return rows(body, "mastertmt", "data", "result")
    .map((row) => ({
      tpucode: String(row.tpucode ?? "").trim(),
      activeingredient: text(row.activeingredient),
      strength: text(row.strength),
      dosageform: text(row.dosageform),
      contvalue: text(row.contvalue),
      contunit: text(row.contunit),
      dispunit: text(row.dispunit),
      tradename: text(row.tradename),
      manufacturer: text(row.manufacturer),
      fsn: text(row.fsn),
      status: text(row.status),
    }))
    .filter((row) => row.tpucode !== "");
}

export interface NlemRecord {
  tpuid: string;
  nlem: string | null;
  changeDate: string | null;
}

export async function fetchNlem(window: { begindate: string; enddate: string }, fetcher: FetchLike = fetch): Promise<NlemRecord[]> {
  const body = await callEndpoint("/nlem", window, fetcher);
  return rows(body, "nlem", "data", "result")
    .map((row) => ({
      tpuid: String(row.tpuid ?? "").trim(),
      nlem: text(row.nlem),
      changeDate: text(row.change_date),
    }))
    .filter((row) => row.tpuid !== "");
}

export interface RegnoRecord {
  tpuid: string;
  regno: string | null;
  changeDate: string | null;
}

export async function fetchRegno(window: { begindate: string; enddate: string }, fetcher: FetchLike = fetch): Promise<RegnoRecord[]> {
  const body = await callEndpoint("/regno", window, fetcher);
  return rows(body, "regno", "data", "result")
    .map((row) => ({
      tpuid: String(row.tpuid ?? "").trim(),
      regno: text(row.regno),
      changeDate: text(row.change_date),
    }))
    .filter((row) => row.tpuid !== "");
}
