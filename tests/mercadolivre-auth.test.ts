import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MercadoLivreTokenManager } from "../src/marketplaces/mercadolivre/auth.js";

describe("MercadoLivreTokenManager", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses a configured static token when the stored token expired without refresh credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deal-finder-auth-"));
    const tokenPath = join(directory, "token.json");
    try {
      await writeFile(tokenPath, JSON.stringify({ accessToken: "expired", expiresAt: Date.now() - 1_000 }), { mode: 0o600 });
      const manager = new MercadoLivreTokenManager({ accessToken: "static", clientId: undefined, clientSecret: undefined, tokenPath, timeoutMs: 1_000 });
      await expect(manager.getAccessToken()).resolves.toBe("static");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("serializes refreshes across token-manager instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deal-finder-auth-"));
    const tokenPath = join(directory, "token.json");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "fresh",
      refresh_token: "rotated",
      expires_in: 3_600,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await writeFile(tokenPath, JSON.stringify({ accessToken: "expired", refreshToken: "old", expiresAt: Date.now() - 1_000 }), { mode: 0o600 });
      const options = { accessToken: undefined, clientId: "client", clientSecret: "secret", tokenPath, timeoutMs: 2_000 };
      const [left, right] = await Promise.all([
        new MercadoLivreTokenManager(options).getAccessToken(),
        new MercadoLivreTokenManager(options).getAccessToken(),
      ]);
      expect([left, right]).toEqual(["fresh", "fresh"]);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("applies the caller deadline to OAuth refresh", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deal-finder-auth-"));
    const tokenPath = join(directory, "token.json");
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) reject(init.signal.reason);
      else init?.signal?.addEventListener("abort", () => { reject(init.signal?.reason); }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await writeFile(tokenPath, JSON.stringify({ accessToken: "expired", refreshToken: "old", expiresAt: Date.now() - 1_000 }), { mode: 0o600 });
      const manager = new MercadoLivreTokenManager({
        accessToken: undefined,
        clientId: "client",
        clientSecret: "secret",
        tokenPath,
        timeoutMs: 2_000,
      });

      await expect(manager.getAccessToken(30)).rejects.toMatchObject({ code: "provider_request_timeout", retryable: true });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
