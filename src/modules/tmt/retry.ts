import { RemoteResponseError } from "@/modules/standards/tmt-client";
import { TmtResponseError } from "@/modules/standards/tmt-parsers";

export interface RetryResult<T> {
  value: T;
  attempts: number;
}

export interface RetryOptions {
  sleep: (milliseconds: number) => Promise<void>;
  random?: () => number;
  refreshAuth?: () => Promise<void>;
  maxAttempts?: number;
}

function isTransient(error: unknown): boolean {
  if (error instanceof RemoteResponseError) return error.status === 429 || error.status >= 500;
  if (error instanceof TmtResponseError) return false;
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  return /network|socket|disconnect|reset|fetch failed|econn/i.test(error.message);
}

export async function runWithRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<RetryResult<T>> {
  const maximum = options.maxAttempts ?? 3;
  if (!Number.isInteger(maximum) || maximum < 1) throw new Error("maxAttempts must be a positive integer");
  const random = options.random ?? Math.random;
  let attempts = 0;
  let authRefreshed = false;

  while (true) {
    attempts += 1;
    try {
      return { value: await operation(), attempts };
    } catch (error) {
      if (error instanceof RemoteResponseError && (error.status === 401 || error.status === 403)) {
        if (authRefreshed || !options.refreshAuth) throw error;
        authRefreshed = true;
        await options.refreshAuth();
        continue;
      }
      if (!isTransient(error) || attempts >= maximum) throw error;
      const exponential = Math.min(10_000, 500 * 2 ** (attempts - 1));
      const jittered = exponential + Math.floor(exponential * Math.max(0, Math.min(1, random())));
      const retryAfter = error instanceof RemoteResponseError ? error.retryAfterMs : null;
      await options.sleep(retryAfter === null ? jittered : Math.min(60_000, Math.max(jittered, retryAfter)));
    }
  }
}
