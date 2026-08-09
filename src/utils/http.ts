import { setTimeout as delay } from "node:timers/promises";
import { ProviderError } from "../marketplaces/provider.js";

export interface FetchOptions {
  timeoutMs: number;
  retries?: number;
  baseDelayMs?: number;
}

export async function fetchWithRetry(url: string | URL, init: RequestInit, options: FetchOptions): Promise<Response> {
  const retries = options.retries ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs) });
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? 0) * 1000;
        if (attempt === retries) throw new ProviderError("provider_rate_limited", `Rate limited: ${url}`, true);
        await delay(Math.max(retryAfter, (options.baseDelayMs ?? 500) * 2 ** attempt));
        continue;
      }
      if (response.status >= 500 && attempt < retries) {
        await delay((options.baseDelayMs ?? 500) * 2 ** attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderError || attempt === retries) throw error;
      await delay((options.baseDelayMs ?? 500) * 2 ** attempt);
    }
  }
  throw lastError;
}
