import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "../src/utils/http.js";

describe("fetchWithRetry", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("never puts a secret URL in a rate-limit error", async () => {
    const token = "123456789:VERY_SECRET_TELEGRAM_TOKEN";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST" }, { timeoutMs: 1_000, retries: 2 });
    await expect(request).rejects.toMatchObject({ code: "provider_rate_limited" });
    await expect(request).rejects.not.toThrow(token);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("releases the final rate-limit response body", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 429,
      headers: new Headers(),
      body: { cancel },
    } as unknown as Response));
    await expect(fetchWithRetry("https://example.com", {}, { timeoutMs: 1_000, retries: 0 }))
      .rejects.toMatchObject({ code: "provider_rate_limited" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("retries safe requests and accepts an HTTP-date Retry-After", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": new Date(0).toUTCString() } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await fetchWithRetry("https://example.com", {}, { timeoutMs: 1_000, retries: 1, baseDelayMs: 0 });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not blindly retry unsafe methods", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await fetchWithRetry("https://example.com", { method: "POST" }, { timeoutMs: 1_000, retries: 3 });
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses one total deadline across all retry attempts", async () => {
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { reject(init.signal?.reason); }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithRetry("https://example.com", {}, { timeoutMs: 20, retries: 3, baseDelayMs: 0 }))
      .rejects.toMatchObject({ code: "provider_request_timeout" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("normalizes an internal timeout on an unsafe final attempt", async () => {
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { reject(init.signal?.reason); }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchWithRetry("https://example.com", { method: "POST" }, { timeoutMs: 20, retries: 0 }))
      .rejects.toMatchObject({ code: "provider_request_timeout" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not turn an external abort into a provider timeout", async () => {
    const controller = new AbortController();
    const reason = new Error("caller_cancelled");
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) reject(init.signal.reason);
      else init?.signal?.addEventListener("abort", () => { reject(init.signal?.reason); }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = fetchWithRetry("https://example.com", { method: "POST", signal: controller.signal }, { timeoutMs: 1_000 });
    controller.abort(reason);
    await expect(request).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
