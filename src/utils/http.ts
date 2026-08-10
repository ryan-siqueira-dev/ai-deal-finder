import { setTimeout as delay } from "node:timers/promises";
import { ProviderError } from "../marketplaces/provider.js";

export interface FetchOptions {
  timeoutMs: number;
  retries?: number;
  baseDelayMs?: number;
  maxRetryDelayMs?: number;
  retryUnsafeMethods?: boolean;
}

function retryDelay(response: Response, fallbackMs: number, maximumMs: number): number {
  const header = response.headers.get("retry-after")?.trim();
  if (!header) return Math.min(fallbackMs, maximumMs);
  const seconds = Number(header);
  const requestedMs = Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Math.max(0, Date.parse(header) - Date.now());
  return Math.min(Number.isFinite(requestedMs) ? requestedMs : fallbackMs, maximumMs);
}

export async function fetchWithRetry(url: string | URL, init: RequestInit, options: FetchOptions): Promise<Response> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new RangeError("timeout_must_be_positive");
  const method = (init.method ?? "GET").toUpperCase();
  const safeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const retries = safeMethod || options.retryUnsafeMethods ? options.retries ?? 2 : 0;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maximumDelayMs = options.maxRetryDelayMs ?? 30_000;
  const deadline = Date.now() + options.timeoutMs;
  let lastError: unknown;
  const timeoutError = (cause?: unknown): ProviderError => new ProviderError(
    "provider_request_timeout",
    "Remote request exceeded its retry deadline",
    true,
    cause === undefined ? undefined : { cause },
  );
  const waitBeforeRetry = async (requestedMs: number): Promise<void> => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw timeoutError(lastError);
    await delay(Math.min(requestedMs, remainingMs), undefined, { signal: init.signal ?? undefined });
    if (Date.now() >= deadline) throw timeoutError(lastError);
  };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw timeoutError(lastError);
    const timeoutSignal = AbortSignal.timeout(Math.max(1, remainingMs));
    const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await fetch(url, { ...init, signal });
      if (response.status === 429) {
        if (attempt === retries) {
          await response.body?.cancel();
          throw new ProviderError("provider_rate_limited", "Remote service rate limited the request", true);
        }
        const fallbackMs = baseDelayMs * 2 ** attempt;
        const waitMs = retryDelay(response, fallbackMs, maximumDelayMs);
        await response.body?.cancel();
        await waitBeforeRetry(waitMs);
        continue;
      }
      if (response.status >= 500 && attempt < retries) {
        await response.body?.cancel();
        await waitBeforeRetry(Math.min(baseDelayMs * 2 ** attempt, maximumDelayMs));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderError) throw error;
      if (init.signal?.aborted) throw error;
      if (timeoutSignal.aborted || Date.now() >= deadline) throw timeoutError(error);
      if (attempt === retries) throw error;
      await waitBeforeRetry(Math.min(baseDelayMs * 2 ** attempt, maximumDelayMs));
    }
  }
  throw lastError;
}
