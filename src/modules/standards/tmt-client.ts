import { createHash } from "node:crypto";
import {
  parseAtcResponse,
  parseConceptResponse,
  parseGpResponse,
  parseGppResponse,
  parseGpuResponse,
  parseImageListResponse,
  parseImageResponse,
  parseMasterTmtResponse,
  parseNlemResponse,
  parseRegnoResponse,
  parseRelationshipResponse,
  parseSubsResponse,
  parseTokenResponse,
  parseTpResponse,
  parseTppResponse,
  parseTpuResponse,
  parseVersionResponse,
  parseVtmResponse,
  TmtResponseError,
  type AtcRecord,
  type ConceptRecord,
  type GpRecord,
  type GppRecord,
  type GpuRecord,
  type ImageListRecord,
  type ImageRecord,
  type MasterTmtRecord,
  type NlemRecord,
  type RegnoRecord,
  type RelationshipRecord,
  type SubsRecord,
  type TpRecord,
  type TppRecord,
  type TpuRecord,
  type VtmRecord,
} from "./tmt-parsers";
/**
 * TMT API adapter.
 *
 * Credentials come from the admin screen (encrypted in app_settings) and fall
 * back to TMT_API_* environment variables. They are server-only and never
 * appear in any returned value or error message. Token responses are cached in memory for the life of the process —
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

import { resolveTmtCredentials, type TmtCredentials } from "./tmt-credentials";

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
  if (error instanceof InvalidResponseError || error instanceof TmtResponseError) {
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

interface CachedToken {
  token: string;
  expiresAt: number;
  /** Identifies the credential the token was issued for, so an admin changing
   * the username, password or base URL cannot keep using the old token. */
  fingerprint: string;
}

let cachedToken: CachedToken | null = null;

function fingerprint(credentials: TmtCredentials): string {
  return createHash("sha256").update(`${credentials.baseUrl}
${credentials.username}
${credentials.password}`).digest("hex");
}

async function requireCredentials(): Promise<TmtCredentials> {
  const credentials = await resolveTmtCredentials();
  if (!credentials) throw new TmtApiError("TMT_CONFIG_MISSING", "ยังไม่ได้ตั้งค่า TMT credential ฝั่ง server");
  return credentials;
}

/** Clears the in-memory token cache. Exposed for tests. */
export function resetTmtTokenCache(): void {
  cachedToken = null;
}

async function fetchToken(fetcher: FetchLike, credentials: TmtCredentials): Promise<string> {
  const { baseUrl, username, password } = credentials;
  const identity = fingerprint(credentials);
  if (cachedToken && cachedToken.fingerprint === identity && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const response = await fetcher(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new RemoteResponseError(response.status, "token");
  const body = parseTokenResponse(await readJson(response));
  const token = body.token;

  const expiry = Date.parse(body.expire);
  cachedToken = {
    token,
    expiresAt: Number.isFinite(expiry) ? expiry : Date.now() + 30 * 60_000,
    fingerprint: identity,
  };
  return token;
}

async function callEndpoint(path: string, payload: Record<string, unknown>, fetcher: FetchLike): Promise<Record<string, unknown>> {
  const credentials = await requireCredentials();
  const token = await fetchToken(fetcher, credentials);
  const response = await fetcher(`${credentials.baseUrl}${path}`, {
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

export async function fetchTmtVersion(fetcher: FetchLike = fetch): Promise<TmtVersionResult> {
  const startedAt = Date.now();
  try {
    const { tmtVersion } = parseVersionResponse(await callEndpoint("/version", {}, fetcher));
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

export type {
  AtcRecord,
  ConceptRecord,
  GpRecord,
  GppRecord,
  GpuRecord,
  ImageListRecord,
  ImageRecord,
  MasterTmtRecord,
  NlemRecord,
  RegnoRecord,
  RelationshipRecord,
  SubsRecord,
  TpRecord,
  TppRecord,
  TpuRecord,
  VtmRecord,
};

export interface DateWindow { begindate: string; enddate: string }

async function fetchWindow<T>(path: string, window: DateWindow, parser: (body: unknown) => T[], fetcher: FetchLike): Promise<T[]> {
  return parser(await callEndpoint(path, { begindate: window.begindate, enddate: window.enddate }, fetcher));
}

export const fetchSubs = (window: DateWindow, fetcher: FetchLike = fetch): Promise<SubsRecord[]> => fetchWindow("/subs", window, parseSubsResponse, fetcher);
export const fetchVtm = (window: DateWindow, fetcher: FetchLike = fetch): Promise<VtmRecord[]> => fetchWindow("/vtm", window, parseVtmResponse, fetcher);
export const fetchGp = (window: DateWindow, fetcher: FetchLike = fetch): Promise<GpRecord[]> => fetchWindow("/gp", window, parseGpResponse, fetcher);
export const fetchGpu = (window: DateWindow, fetcher: FetchLike = fetch): Promise<GpuRecord[]> => fetchWindow("/gpu", window, parseGpuResponse, fetcher);
export const fetchGpp = (window: DateWindow, fetcher: FetchLike = fetch): Promise<GppRecord[]> => fetchWindow("/gpp", window, parseGppResponse, fetcher);
export const fetchTp = (window: DateWindow, fetcher: FetchLike = fetch): Promise<TpRecord[]> => fetchWindow("/tp", window, parseTpResponse, fetcher);
export const fetchTpu = (window: DateWindow, fetcher: FetchLike = fetch): Promise<TpuRecord[]> => fetchWindow("/tpu", window, parseTpuResponse, fetcher);
export const fetchTpp = (window: DateWindow, fetcher: FetchLike = fetch): Promise<TppRecord[]> => fetchWindow("/tpp", window, parseTppResponse, fetcher);
export const fetchImageList = (window: DateWindow, fetcher: FetchLike = fetch): Promise<ImageListRecord[]> => fetchWindow("/imagelist", window, parseImageListResponse, fetcher);
export const fetchNlem = (window: DateWindow, fetcher: FetchLike = fetch): Promise<NlemRecord[]> => fetchWindow("/nlem", window, parseNlemResponse, fetcher);
export const fetchAtc = (window: DateWindow, fetcher: FetchLike = fetch): Promise<AtcRecord[]> => fetchWindow("/atc", window, parseAtcResponse, fetcher);
export const fetchRegno = (window: DateWindow, fetcher: FetchLike = fetch): Promise<RegnoRecord[]> => fetchWindow("/regno", window, parseRegnoResponse, fetcher);
export const fetchMasterTmt = (window: DateWindow, fetcher: FetchLike = fetch): Promise<MasterTmtRecord[]> => fetchWindow("/mastertmt", window, parseMasterTmtResponse, fetcher);
export const fetchConcept = (window: DateWindow, fetcher: FetchLike = fetch): Promise<ConceptRecord[]> => fetchWindow("/concept", window, parseConceptResponse, fetcher);
export const fetchRelationship = (window: DateWindow, fetcher: FetchLike = fetch): Promise<RelationshipRecord[]> => fetchWindow("/relationship", window, parseRelationshipResponse, fetcher);

export async function fetchImage(tpuid: string, fetcher: FetchLike = fetch): Promise<ImageRecord[]> {
  if (!/^\d+$/.test(tpuid)) throw new TmtApiError("TMT_INVALID_TPUID", "รหัส TPU ไม่ถูกต้อง");
  return parseImageResponse(await callEndpoint("/image", { tpuid }, fetcher));
}
