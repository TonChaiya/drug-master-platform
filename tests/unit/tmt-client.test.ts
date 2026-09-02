import { afterEach, describe, expect, it } from "vitest";
import { fetchTmtVersion } from "@/lib/poc/tmt-client";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("fetchTmtVersion", () => {
  it("returns a sanitized configuration error", async () => {
    delete process.env.TMT_API_USER;
    delete process.env.TMT_API_PASSWORD;
    const result = await fetchTmtVersion();
    expect(result).toMatchObject({ ok: false, errorCode: "TMT_CONFIG_MISSING", tmtVersion: null });
  });

  it("uses a server-only token and reads the version", async () => {
    process.env.TMT_API_USER = "fixture-user";
    process.env.TMT_API_PASSWORD = "fixture-password";
    process.env.TMT_API_BASE = "https://tmt.example.test/tmtapi";
    let call = 0;
    const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        expect(init?.body).toContain("fixture-user");
        return new Response(JSON.stringify({ success: "true", token: "fixture-token" }), { status: 200 });
      }
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-token");
      return new Response(JSON.stringify({ success: "true", tmt_version: "20260101" }), { status: 200 });
    }) as typeof fetch;
    const result = await fetchTmtVersion(mockFetch);
    expect(result).toMatchObject({ ok: true, tmtVersion: "20260101", httpStatus: 200, errorCode: null });
    expect(JSON.stringify(result)).not.toContain("fixture-token");
    expect(JSON.stringify(result)).not.toContain("fixture-password");
  });

  it("separates authorization and invalid JSON failures", async () => {
    process.env.TMT_API_USER = "fixture-user";
    process.env.TMT_API_PASSWORD = "fixture-password";
    const unauthorizedFetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await expect(fetchTmtVersion(unauthorizedFetch)).resolves.toMatchObject({ errorCode: "TMT_AUTH", httpStatus: 401 });

    const invalidJsonFetch = (async () => new Response("not-json", { status: 200 })) as typeof fetch;
    await expect(fetchTmtVersion(invalidJsonFetch)).resolves.toMatchObject({ errorCode: "TMT_INVALID_JSON" });
  });
});
