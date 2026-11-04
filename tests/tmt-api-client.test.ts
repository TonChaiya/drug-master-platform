import assert from "node:assert/strict";
import { afterEach, describe, test, vi } from "vitest";

vi.mock("@/modules/standards/tmt-credentials", () => ({
  resolveTmtCredentials: async () => ({
    baseUrl: "https://tmt-fixture.invalid",
    username: "fixture-user",
    password: "fixture-password",
  }),
}));

import {
  fetchAtc,
  fetchConcept,
  fetchGp,
  fetchGpp,
  fetchGpu,
  fetchImage,
  fetchImageList,
  fetchMasterTmt,
  fetchNlem,
  fetchRegno,
  fetchRelationship,
  fetchSubs,
  fetchTp,
  fetchTpp,
  fetchTpu,
  fetchTmtVersion,
  fetchVtm,
  resetTmtTokenCache,
} from "@/modules/standards/tmt-client";
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
} from "@/modules/standards/tmt-parsers";

const dateWindow = { begindate: "2026-01-01", enddate: "2026-12-31" };
const simple = (id: string) => ({ data: [{ [id]: 9007199254740993n.toString(), fsn: "  fixture fsn  ", change_date: "2026-01-02" }] });
const trade = (id: string) => ({ data: [{ [id]: 123, fsn: " trade fsn ", manufacturer: " maker ", change_date: "2026-01-02" }] });

afterEach(() => resetTmtTokenCache());

test("all level parsers preserve exact identifier strings and trim required text", () => {
  const cases = [
    [parseSubsResponse, simple("subsid"), "subsid"],
    [parseVtmResponse, simple("vtmid"), "vtmid"],
    [parseGpResponse, simple("gpid"), "gpid"],
    [parseGpuResponse, simple("gpuid"), "gpuid"],
    [parseGppResponse, simple("gppid"), "gppid"],
  ] as const;

  for (const [parse, fixture, id] of cases) {
    const row = parse(fixture)[0];
    assert.equal((row as unknown as Record<string, string> | undefined)?.[id], "9007199254740993");
    assert.equal(row?.fsn, "fixture fsn");
    assert.equal(row?.changeDate, "2026-01-02");
  }
});

test("trade level and image-list parsers keep endpoint-specific fields", () => {
  for (const [parse, id] of [[parseTpResponse, "tpid"], [parseTpuResponse, "tpuid"], [parseTppResponse, "tppid"]] as const) {
    const row = parse(trade(id))[0];
    assert.equal((row as unknown as Record<string, string> | undefined)?.[id], "123");
    assert.equal(row?.manufacturer, "maker");
  }
  assert.deepEqual(parseImageListResponse({ data: [{ tpuid: 44, fsn: " image ", change_date: "2026-01-03" }] }), [
    { tpuid: "44", fsn: "image", changeDate: "2026-01-03" },
  ]);
});

test("image parser validates nested package identifiers while preserving image-face keys", () => {
  assert.deepEqual(
    parseImageResponse({
      data: [{
        tpuid: 44,
        fsn: " image ",
        pill: "AA==",
        pills: null,
        packages: [{ tppid: "55", fsn: " pack ", front: "AA==", back: null, left: "" }],
      }],
    }),
    [{
      tpuid: "44",
      fsn: "image",
      pill: "AA==",
      pills: null,
      packages: [{ tppid: "55", fsn: "pack", images: { front: "AA==", back: null, left: null } }],
    }],
  );
});

test("temporal enrichment parsers preserve source values and direction", () => {
  assert.deepEqual(parseNlemResponse({ data: [{ tpuid: 1, fsn: " x ", nlem: " ED* ", change_date: "2026-01-01" }] }), [
    { tpuid: "1", fsn: "x", nlem: "ED*", changeDate: "2026-01-01" },
  ]);
  assert.deepEqual(parseAtcResponse({ data: [{ tpuid: 1, fsn: " x ", atc: " A01 ", change_date: "2026-01-01" }] }), [
    { tpuid: "1", fsn: "x", atc: "A01", changeDate: "2026-01-01" },
  ]);
  assert.deepEqual(parseRegnoResponse({ data: [{ tpuid: 1, fsn: " x ", regno: " 1A ", change_date: "2026-01-01" }] }), [
    { tpuid: "1", fsn: "x", regno: "1A", changeDate: "2026-01-01" },
  ]);
  assert.deepEqual(parseRelationshipResponse({ data: [{ concept1: 10, concept2: 20, change_date: "2026-01-01", level_name1: "gpu", level_name2: "tpu" }] }), [
    { concept1: "10", concept2: "20", changeDate: "2026-01-01", levelName1: "gpu", levelName2: "tpu" },
  ]);
});

test("MasterTMT preserves numeric status and nullable source text", () => {
  const base = {
    tpucode: 100,
    activeingredient: null,
    strength: "",
    dosageform: " tablet ",
    contvalue: null,
    contunit: "",
    dispunit: " tablet ",
    tradename: null,
    manufacturer: " maker ",
    fsn: " fsn ",
  };
  const rows = parseMasterTmtResponse({ data: [{ ...base, status: 0 }, { ...base, tpucode: 101, status: 1 }] });
  assert.equal(rows[0]?.status, 0);
  assert.equal(rows[1]?.status, 1);
  assert.equal(rows[0]?.activeingredient, null);
  assert.equal(rows[0]?.strength, null);
  assert.equal(rows[0]?.dosageform, "tablet");
});

test("concept accepts an unknown future level without inventing an enum", () => {
  assert.deepEqual(parseConceptResponse({ data: [{ tmtid: 1, fsn: " future ", change_date: "2026-01-01", level_name: "future-level" }] }), [
    { tmtid: "1", fsn: "future", changeDate: "2026-01-01", levelName: "future-level" },
  ]);
});

test("token and version parsers validate documented roots", () => {
  assert.deepEqual(parseTokenResponse({ success: "true", create: "2026-01-01", expire: "2026-12-31", token: " fixture-token " }), {
    success: "true", create: "2026-01-01", expire: "2026-12-31", token: "fixture-token",
  });
  assert.deepEqual(parseVersionResponse({ success: "true", tmt_version: "20261102" }), { tmtVersion: "20261102" });
});

test("empty data is valid but malformed roots, missing IDs, and wrong types fail closed", () => {
  assert.deepEqual(parseSubsResponse({ data: [] }), []);
  for (const input of [{}, { data: [{ fsn: "x", change_date: "2026-01-01" }] }, { data: [{ subsid: {}, fsn: "x", change_date: "2026-01-01" }] }]) {
    assert.throws(() => parseSubsResponse(input), /TMT API response does not match the documented contract/);
  }
  assert.throws(
    () => parseRelationshipResponse({ data: [{ concept1: 1, concept2: 2, change_date: "2026-01-01", level_name1: "gpu" }] }),
    /TMT API response does not match the documented contract/,
  );
});

test("exact duplicate TPP payload parses deterministically", () => {
  const row = { tppid: 99, fsn: "same", manufacturer: "same", change_date: "2026-01-01" };
  const parsed = parseTppResponse({ data: [row, row] });
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], parsed[1]);
});

describe("typed client endpoint routing", () => {
  test("all documented bearer endpoints use their exact path and expected payload", async () => {
    const endpointCases = [
      ["/subs", (fetcher: typeof fetch) => fetchSubs(dateWindow, fetcher), simple("subsid")],
      ["/vtm", (fetcher: typeof fetch) => fetchVtm(dateWindow, fetcher), simple("vtmid")],
      ["/gp", (fetcher: typeof fetch) => fetchGp(dateWindow, fetcher), simple("gpid")],
      ["/gpu", (fetcher: typeof fetch) => fetchGpu(dateWindow, fetcher), simple("gpuid")],
      ["/gpp", (fetcher: typeof fetch) => fetchGpp(dateWindow, fetcher), simple("gppid")],
      ["/tp", (fetcher: typeof fetch) => fetchTp(dateWindow, fetcher), trade("tpid")],
      ["/tpu", (fetcher: typeof fetch) => fetchTpu(dateWindow, fetcher), trade("tpuid")],
      ["/tpp", (fetcher: typeof fetch) => fetchTpp(dateWindow, fetcher), trade("tppid")],
      ["/imagelist", (fetcher: typeof fetch) => fetchImageList(dateWindow, fetcher), { data: [] }],
      ["/image", (fetcher: typeof fetch) => fetchImage("123", fetcher), { data: [] }],
      ["/nlem", (fetcher: typeof fetch) => fetchNlem(dateWindow, fetcher), { data: [] }],
      ["/atc", (fetcher: typeof fetch) => fetchAtc(dateWindow, fetcher), { data: [] }],
      ["/regno", (fetcher: typeof fetch) => fetchRegno(dateWindow, fetcher), { data: [] }],
      ["/mastertmt", (fetcher: typeof fetch) => fetchMasterTmt(dateWindow, fetcher), { data: [] }],
      ["/concept", (fetcher: typeof fetch) => fetchConcept(dateWindow, fetcher), { data: [] }],
      ["/relationship", (fetcher: typeof fetch) => fetchRelationship(dateWindow, fetcher), { data: [] }],
    ] as const;

    for (const [path, call, body] of endpointCases) {
      resetTmtTokenCache();
      const urls: string[] = [];
      const payloads: unknown[] = [];
      const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        payloads.push(init?.body ? JSON.parse(String(init.body)) : null);
        if (url.endsWith("/token")) return Response.json({ success: "true", create: "2026-01-01", expire: "2099-01-01", token: "fixture-token" });
        return Response.json(body);
      }) as unknown as typeof fetch;

      await call(fetcher);
      assert.equal(urls[1], `https://tmt-fixture.invalid${path}`);
      assert.deepEqual(payloads[1], path === "/image" ? { tpuid: "123" } : dateWindow);
    }
  });

  test("version uses an empty body and reports sanitized invalid-response errors", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/token")) return Response.json({ success: "true", create: "2026-01-01", expire: "2099-01-01", token: "fixture-token" });
      return Response.json({ success: "true", tmt_version: "fixture-token-must-not-leak" });
    }) as unknown as typeof fetch;
    const result = await fetchTmtVersion(fetcher);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "TMT_INVALID_RESPONSE");
    assert.doesNotMatch(result.message, /fixture-token/);
  });
});
