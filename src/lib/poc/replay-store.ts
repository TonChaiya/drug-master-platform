export interface ReplayStore {
  claim(key: string, expiresAtMs: number): Promise<boolean>;
}

export class MemoryReplayStore implements ReplayStore {
  private readonly entries = new Map<string, number>();

  async claim(key: string, expiresAtMs: number): Promise<boolean> {
    const now = Date.now();
    for (const [nonceKey, expiry] of this.entries) {
      if (expiry <= now) this.entries.delete(nonceKey);
    }
    if (this.entries.has(key)) return false;
    this.entries.set(key, expiresAtMs);
    return true;
  }
}

declare global {
  var pocReplayStore: ReplayStore | undefined;
}

async function createReplayStore(): Promise<ReplayStore> {
  if (process.env.NODE_ENV !== "test" && process.env.POC_STATE_STORE === "tidb") {
    const { TiDbReplayStore } = await import("@/lib/poc/tidb-replay-store");
    return new TiDbReplayStore();
  }
  return new MemoryReplayStore();
}

export const replayStore = globalThis.pocReplayStore ?? (await createReplayStore());
if (process.env.NODE_ENV !== "production") globalThis.pocReplayStore = replayStore;
