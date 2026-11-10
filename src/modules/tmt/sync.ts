import { randomUUID } from "node:crypto";
import {
  fetchAtc,
  fetchConcept,
  fetchGp,
  fetchGpp,
  fetchGpu,
  fetchImageList,
  fetchMasterTmt,
  fetchNlem,
  fetchRegno,
  fetchRelationship,
  fetchSubs,
  fetchTmtVersion,
  fetchTp,
  fetchTpp,
  fetchTpu,
  fetchVtm,
  createTmtApiClient,
  RemoteResponseError,
  resetTmtTokenCache,
  TmtApiError,
} from "@/modules/standards/tmt-client";
import type { TmtCredentials } from "@/modules/standards/tmt-credentials";
import type { PersistWindowInput, PersistWindowResult, TmtCheckpointRow, TmtDataEndpoint, TmtEndpointRows, TmtRunMode, TmtRunRow, TmtRunStatus } from "./persistence";
import { runWithRetry } from "./retry";
import { bangkokDate, incrementalWindow, partitionHistoricalWindows, TMT_HISTORY_START, type TmtDateWindow } from "./windows";

export const TMT_CORE_ENDPOINTS: readonly TmtDataEndpoint[] = [
  "subs", "vtm", "gp", "gpu", "gpp", "tp", "tpu", "tpp", "nlem", "regno", "mastertmt", "concept", "relationship",
];
export const TMT_OPTIONAL_ENDPOINTS: readonly TmtDataEndpoint[] = ["atc", "imagelist"];
export const TMT_UNVERIFIED_REQUIRED_ENDPOINTS: readonly TmtDataEndpoint[] = [...TMT_CORE_ENDPOINTS, "atc"];
export const TMT_UNVERIFIED_OPTIONAL_ENDPOINTS: readonly TmtDataEndpoint[] = ["imagelist"];

export interface TmtSyncSource {
  version(): Promise<string>;
  fetch<E extends TmtDataEndpoint>(endpoint: E, window: TmtDateWindow): Promise<TmtEndpointRows[E]>;
  resetAuthentication(): Promise<void>;
}

export interface TmtSyncStore {
  createRun(input: { id: string; version: string; mode: TmtRunMode; startedAt: Date; startedBy?: string | null }): Promise<void>;
  observeVersion(input: { id: string; version: string; observedAt: Date; runId: string; latencyMs?: number | null }): Promise<void>;
  ensureCheckpoint(input: { runId: string; endpoint: TmtDataEndpoint; window: TmtDateWindow }): Promise<void>;
  persistWindow<E extends TmtDataEndpoint>(input: PersistWindowInput<E>): Promise<PersistWindowResult>;
  failCheckpoint(input: { runId: string; endpoint: TmtDataEndpoint; window: TmtDateWindow; attempts: number; errorCode: string; finishedAt: Date }): Promise<void>;
  finishRun(input: { runId: string; status: TmtRunStatus; receivedRows: number; writtenRows: number; warningsCount: number; errorCode: string | null; finishedAt: Date }): Promise<void>;
  latestSuccessfulEnd(endpoint: TmtDataEndpoint): Promise<string | null>;
  loadRun(runId: string): Promise<TmtRunRow>;
  incompleteCheckpoints(runId: string): Promise<TmtCheckpointRow[]>;
}

export interface TmtSyncResult {
  runId: string;
  version: string;
  status: TmtRunStatus;
  errorCode: string | null;
  coreReady: boolean;
  receivedRows: number;
  uniqueRows: number;
  writtenRows: number;
  duplicateRows: number;
  totalAttempts: number;
  warningsCount: number;
  optionalWarnings: Array<{ endpoint: TmtDataEndpoint; window: TmtDateWindow; errorCode: string }>;
}

interface CommonOptions {
  source: TmtSyncSource;
  store: TmtSyncStore;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  random?: () => number;
  coreEndpoints?: readonly TmtDataEndpoint[];
  optionalEndpoints?: readonly TmtDataEndpoint[];
  invariantCheck?: (runId: string) => Promise<{ warningsCount: number }>;
  startedBy?: string | null;
}

interface RunState {
  receivedRows: number;
  uniqueRows: number;
  writtenRows: number;
  duplicateRows: number;
  totalAttempts: number;
  warningsCount: number;
  optionalWarnings: TmtSyncResult["optionalWarnings"];
}

function initialState(): RunState {
  return { receivedRows: 0, uniqueRows: 0, writtenRows: 0, duplicateRows: 0, totalAttempts: 0, warningsCount: 0, optionalWarnings: [] };
}

function errorCode(error: unknown): string {
  if (error instanceof RemoteResponseError) return `TMT_HTTP_${error.status}`;
  if (error instanceof TmtApiError) return error.code.slice(0, 64);
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "TMT_TIMEOUT";
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code.slice(0, 64);
  return error instanceof Error ? error.name.slice(0, 64) : "TMT_UNKNOWN";
}

async function readVersion(options: CommonOptions): Promise<{ version: string; attempts: number }> {
  return runWithRetry(() => options.source.version(), {
    sleep: options.sleep,
    random: options.random,
    refreshAuth: () => options.source.resetAuthentication(),
  }).then((result) => ({ version: result.value, attempts: result.attempts }));
}

async function processCheckpoint(
  options: CommonOptions,
  runId: string,
  version: string,
  endpoint: TmtDataEndpoint,
  window: TmtDateWindow,
  state: RunState,
): Promise<void> {
  let attempts = 0;
  try {
    const fetched = await runWithRetry(async () => {
      attempts += 1;
      return options.source.fetch(endpoint, window);
    }, {
      sleep: options.sleep,
      random: options.random,
      refreshAuth: () => options.source.resetAuthentication(),
    });
    state.totalAttempts += fetched.attempts;
    const persisted = await options.store.persistWindow({
      runId,
      endpoint,
      window,
      version,
      syncedAt: options.now(),
      rows: fetched.value,
      attempts: fetched.attempts,
    });
    state.receivedRows += persisted.receivedRows;
    state.uniqueRows += persisted.uniqueRows;
    state.writtenRows += persisted.writtenRows;
    state.duplicateRows += persisted.duplicateRows;
    state.warningsCount += persisted.warnings.length;
  } catch (error) {
    state.totalAttempts += attempts;
    await options.store.failCheckpoint({ runId, endpoint, window, attempts: Math.max(1, attempts), errorCode: errorCode(error), finishedAt: options.now() });
    throw error;
  }
}

async function finish(
  options: CommonOptions,
  runId: string,
  version: string,
  state: RunState,
  status: TmtSyncResult["status"],
  code: string | null,
): Promise<TmtSyncResult> {
  await options.store.finishRun({
    runId,
    status,
    errorCode: code,
    receivedRows: state.receivedRows,
    writtenRows: state.writtenRows,
    warningsCount: state.warningsCount + state.optionalWarnings.length,
    finishedAt: options.now(),
  });
  return {
    runId,
    version,
    status,
    errorCode: code,
    coreReady: status === "succeeded",
    receivedRows: state.receivedRows,
    uniqueRows: state.uniqueRows,
    writtenRows: state.writtenRows,
    duplicateRows: state.duplicateRows,
    totalAttempts: state.totalAttempts,
    warningsCount: state.warningsCount + state.optionalWarnings.length,
    optionalWarnings: state.optionalWarnings,
  };
}

async function executeCheckpoints(
  options: CommonOptions,
  runId: string,
  version: string,
  checkpoints: TmtCheckpointRow[],
  state: RunState,
  completion: "versioned" | "unverified" = "versioned",
): Promise<TmtSyncResult> {
  const core = new Set(options.coreEndpoints ?? TMT_CORE_ENDPOINTS);
  for (const checkpoint of checkpoints.filter((row) => core.has(row.endpoint))) {
    try {
      await processCheckpoint(options, runId, version, checkpoint.endpoint, checkpoint.window, state);
    } catch (error) {
      return finish(options, runId, version, state, "failed", errorCode(error));
    }
  }
  const optional = new Set(options.optionalEndpoints ?? TMT_OPTIONAL_ENDPOINTS);
  for (const checkpoint of checkpoints.filter((row) => optional.has(row.endpoint))) {
    try {
      await processCheckpoint(options, runId, version, checkpoint.endpoint, checkpoint.window, state);
    } catch (error) {
      state.optionalWarnings.push({ endpoint: checkpoint.endpoint, window: checkpoint.window, errorCode: errorCode(error) });
    }
  }
  if (completion === "unverified") {
    try {
      const invariants = await options.invariantCheck?.(runId);
      state.warningsCount += invariants?.warningsCount ?? 0;
    } catch (error) {
      return finish(options, runId, version, state, "failed", errorCode(error));
    }
    return finish(options, runId, version, state, "unverified", "TMT_VERSION_UNVERIFIED");
  }
  let finalVersion: Awaited<ReturnType<typeof readVersion>>;
  try {
    finalVersion = await readVersion(options);
    state.totalAttempts += finalVersion.attempts;
    await options.store.observeVersion({ id: randomUUID(), version: finalVersion.version, observedAt: options.now(), runId });
    if (finalVersion.version === version) {
      const invariants = await options.invariantCheck?.(runId);
      state.warningsCount += invariants?.warningsCount ?? 0;
    }
  } catch (error) {
    return finish(options, runId, version, state, "failed", errorCode(error));
  }
  if (finalVersion.version !== version) return finish(options, runId, version, state, "stale", "TMT_VERSION_DRIFT");
  return finish(options, runId, version, state, "succeeded", null);
}

async function startRun(
  mode: "full" | "incremental",
  options: CommonOptions,
  windowsFor: (endpoint: TmtDataEndpoint, endDate: string) => Promise<TmtDateWindow[]>,
): Promise<TmtSyncResult> {
  const firstVersion = await readVersion(options);
  const runId = randomUUID();
  const startedAt = options.now();
  await options.store.createRun({ id: runId, version: firstVersion.version, mode, startedAt, startedBy: options.startedBy });
  await options.store.observeVersion({ id: randomUUID(), version: firstVersion.version, observedAt: startedAt, runId });
  const endpoints = [...(options.coreEndpoints ?? TMT_CORE_ENDPOINTS), ...(options.optionalEndpoints ?? TMT_OPTIONAL_ENDPOINTS)];
  const checkpoints: TmtCheckpointRow[] = [];
  const endDate = bangkokDate(startedAt);
  for (const endpoint of endpoints) {
    for (const window of await windowsFor(endpoint, endDate)) {
      await options.store.ensureCheckpoint({ runId, endpoint, window });
      checkpoints.push({ runId, endpoint, window, status: "pending" });
    }
  }
  const state = initialState();
  state.totalAttempts = firstVersion.attempts;
  return executeCheckpoints(options, runId, firstVersion.version, checkpoints, state);
}

export async function runInitialTmtSync(options: CommonOptions & { historyStart?: string }): Promise<TmtSyncResult> {
  return startRun("full", options, async (_endpoint, endDate) => partitionHistoricalWindows(options.historyStart ?? TMT_HISTORY_START, endDate));
}

export async function runIncrementalTmtSync(options: CommonOptions): Promise<TmtSyncResult> {
  return startRun("incremental", options, async (endpoint, endDate) => {
    const overlap = incrementalWindow(await options.store.latestSuccessfulEnd(endpoint), endDate);
    return partitionHistoricalWindows(overlap.begindate, overlap.enddate);
  });
}

export async function runUnverifiedInitialTmtSync(
  options: Omit<CommonOptions, "store" | "coreEndpoints" | "optionalEndpoints"> & {
    store: TmtSyncStore;
    historyStart?: string;
    requiredEndpoints?: readonly TmtDataEndpoint[];
    optionalEndpoints?: readonly TmtDataEndpoint[];
  },
): Promise<TmtSyncResult> {
  const runId = randomUUID();
  const version = `unverified:${runId.replaceAll("-", "").slice(0, 20)}`;
  const startedAt = options.now();
  await options.store.createRun({ id: runId, version, mode: "full_unverified", startedAt, startedBy: options.startedBy });
  const requiredEndpoints = options.requiredEndpoints ?? TMT_UNVERIFIED_REQUIRED_ENDPOINTS;
  const optionalEndpoints = options.optionalEndpoints ?? TMT_UNVERIFIED_OPTIONAL_ENDPOINTS;
  const endpoints = [...requiredEndpoints, ...optionalEndpoints];
  const checkpoints: TmtCheckpointRow[] = [];
  const endDate = bangkokDate(startedAt);
  for (const endpoint of endpoints) {
    for (const window of partitionHistoricalWindows(options.historyStart ?? TMT_HISTORY_START, endDate)) {
      await options.store.ensureCheckpoint({ runId, endpoint, window });
      checkpoints.push({ runId, endpoint, window, status: "pending" });
    }
  }
  return executeCheckpoints(
    { ...options, coreEndpoints: requiredEndpoints, optionalEndpoints },
    runId,
    version,
    checkpoints,
    initialState(),
    "unverified",
  );
}

export async function resumeTmtSyncRun(options: CommonOptions & { runId: string }): Promise<TmtSyncResult> {
  const run = await options.store.loadRun(options.runId);
  if (run.mode === "full_unverified") throw new Error("Unverified TMT sync runs cannot be resumed");
  const currentVersion = await readVersion(options);
  const state = initialState();
  state.totalAttempts = currentVersion.attempts;
  if (currentVersion.version !== run.tmtVersion) return finish(options, run.id, run.tmtVersion, state, "stale", "TMT_VERSION_DRIFT");
  const checkpoints = await options.store.incompleteCheckpoints(run.id);
  return executeCheckpoints(options, run.id, run.tmtVersion, checkpoints, state);
}

export function createDefaultTmtSyncSource(): TmtSyncSource {
  return {
    async version() {
      const result = await fetchTmtVersion();
      if (result.ok && result.tmtVersion) return result.tmtVersion;
      if (result.httpStatus) throw new RemoteResponseError(result.httpStatus, "/version");
      throw new TmtApiError(result.errorCode ?? "TMT_VERSION_FAILED", result.message);
    },
    async fetch<E extends TmtDataEndpoint>(endpoint: E, window: TmtDateWindow): Promise<TmtEndpointRows[E]> {
      const value = await (async (): Promise<TmtEndpointRows[TmtDataEndpoint]> => {
        switch (endpoint) {
          case "subs": return fetchSubs(window);
          case "vtm": return fetchVtm(window);
          case "gp": return fetchGp(window);
          case "gpu": return fetchGpu(window);
          case "gpp": return fetchGpp(window);
          case "tp": return fetchTp(window);
          case "tpu": return fetchTpu(window);
          case "tpp": return fetchTpp(window);
          case "nlem": return fetchNlem(window);
          case "atc": return fetchAtc(window);
          case "regno": return fetchRegno(window);
          case "mastertmt": return fetchMasterTmt(window);
          case "concept": return fetchConcept(window);
          case "relationship": return fetchRelationship(window);
          case "imagelist": return fetchImageList(window);
        }
      })();
      return value as TmtEndpointRows[E];
    },
    async resetAuthentication() { resetTmtTokenCache(); },
  };
}

export function createCredentialTmtSyncSource(credentials: TmtCredentials): TmtSyncSource {
  const client = createTmtApiClient(credentials);
  return {
    version: () => client.version(),
    async fetch<E extends TmtDataEndpoint>(endpoint: E, window: TmtDateWindow): Promise<TmtEndpointRows[E]> {
      return await client.fetch(endpoint, window) as TmtEndpointRows[E];
    },
    async resetAuthentication() { resetTmtTokenCache(); },
  };
}
