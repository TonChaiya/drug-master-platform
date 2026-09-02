import { createHash } from "node:crypto";
import { type ResultSetHeader } from "mysql2/promise";
import type { ReplayStore } from "@/lib/poc/replay-store";
import { getPocTiDbPool } from "@/lib/poc/tidb";

interface DuplicateEntryError extends Error {
  code?: string;
}

export class TiDbReplayStore implements ReplayStore {
  async claim(key: string, expiresAtMs: number): Promise<boolean> {
    const keyHash = createHash("sha256").update(key, "utf8").digest("hex");
    try {
      await getPocTiDbPool().execute<ResultSetHeader>(
        "INSERT INTO poc_agent_nonces (nonce_key_hash, expires_at) VALUES (?, ?)",
        [keyHash, new Date(expiresAtMs)],
      );
      return true;
    } catch (error) {
      if ((error as DuplicateEntryError).code === "ER_DUP_ENTRY") return false;
      throw error;
    }
  }
}
