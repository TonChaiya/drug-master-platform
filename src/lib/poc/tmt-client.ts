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
    readonly stage: "token" | "version",
  ) {
    super(`TMT ${stage} returned HTTP ${status}`);
  }
}

class InvalidJsonError extends Error {}
class InvalidResponseError extends Error {}

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

export async function fetchTmtVersion(fetcher: FetchLike = fetch): Promise<TmtVersionResult> {
  const startedAt = Date.now();
  const base = process.env.TMT_API_BASE?.trim().replace(/\/$/, "") || "https://tmt.this.or.th/tmtapi";
  const username = process.env.TMT_API_USER?.trim();
  const password = process.env.TMT_API_PASSWORD;
  if (!username || !password) {
    return { ok: false, tmtVersion: null, httpStatus: null, latencyMs: 0, errorCode: "TMT_CONFIG_MISSING", message: "ยังไม่ได้ตั้งค่า TMT credential ฝั่ง server" };
  }

  try {
    const signal = AbortSignal.timeout(15_000);
    const tokenResponse = await fetcher(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
      signal,
    });
    if (!tokenResponse.ok) throw new RemoteResponseError(tokenResponse.status, "token");
    const tokenBody = objectValue(await readJson(tokenResponse));
    if (tokenBody.success !== true && tokenBody.success !== "true") throw new InvalidResponseError();
    const token = typeof tokenBody.token === "string" ? tokenBody.token.trim() : "";
    if (!token) throw new InvalidResponseError();

    const versionResponse = await fetcher(`${base}/version`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: "{}",
      cache: "no-store",
      signal,
    });
    if (!versionResponse.ok) throw new RemoteResponseError(versionResponse.status, "version");
    const versionBody = objectValue(await readJson(versionResponse));
    if (versionBody.success !== true && versionBody.success !== "true") throw new InvalidResponseError();
    const tmtVersion = typeof versionBody.tmt_version === "string" ? versionBody.tmt_version.trim() : "";
    if (!/^\d{8}$/.test(tmtVersion)) throw new InvalidResponseError();
    return {
      ok: true,
      tmtVersion,
      httpStatus: versionResponse.status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      errorCode: null,
      message: "เชื่อมต่อ TMT API สำเร็จ",
    };
  } catch (error) {
    return resultError(startedAt, error);
  }
}
