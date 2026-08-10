import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { ProviderError } from "../provider.js";
import { fetchWithRetry } from "../../utils/http.js";

const oauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
});

const storedTokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.number().int().positive(),
});

type StoredToken = z.infer<typeof storedTokenSchema>;

export interface MercadoLivreOAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface MercadoLivreTokenManagerOptions {
  accessToken: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  tokenPath: string;
  timeoutMs: number;
}

async function requestToken(body: URLSearchParams, timeoutMs: number): Promise<z.infer<typeof oauthTokenResponseSchema>> {
  const response = await fetchWithRetry("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }, { timeoutMs, retries: 0 });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError("mercadolivre_oauth_failed", `Mercado Livre OAuth returned ${response.status}`);
  }
  const parsed = oauthTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new ProviderError("mercadolivre_oauth_invalid_response", parsed.error.message);
  return parsed.data;
}

async function withTokenFileLock<T>(tokenPath: string, timeoutMs: number, operation: () => Promise<T>): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeout_must_be_positive");
  await mkdir(dirname(tokenPath), { recursive: true });
  const lockPath = `${tokenPath}.lock`;
  const deadline = Date.now() + timeoutMs;
  const staleAfterMs = Math.max(300_000, timeoutMs * 3);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  while (!handle) {
    try {
      const candidate = await open(lockPath, "wx", 0o600);
      try { await candidate.writeFile(`${process.pid}\n`, "utf8"); }
      catch (error) {
        await candidate.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
      handle = candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > staleAfterMs) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) throw new ProviderError("mercadolivre_token_lock_timeout", "Timed out waiting for the Mercado Livre token lock", true);
      await delay(Math.min(100 + Math.floor(Math.random() * 100), Math.max(1, deadline - Date.now())));
    }
  }
  try { return await operation(); }
  finally {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}

async function writeStoredToken(path: string, token: StoredToken): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(token, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function exchangeMercadoLivreAuthorizationCode(input: {
  credentials: MercadoLivreOAuthCredentials;
  code: string;
  codeVerifier: string;
  tokenPath: string;
  timeoutMs: number;
}): Promise<void> {
  await withTokenFileLock(input.tokenPath, input.timeoutMs, async () => {
    const response = await requestToken(new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.credentials.clientId,
      client_secret: input.credentials.clientSecret,
      code: input.code,
      redirect_uri: input.credentials.redirectUri,
      code_verifier: input.codeVerifier,
    }), input.timeoutMs);
    await writeStoredToken(input.tokenPath, {
      accessToken: response.access_token,
      ...(response.refresh_token ? { refreshToken: response.refresh_token } : {}),
      expiresAt: Date.now() + response.expires_in * 1000,
    });
  });
}

export class MercadoLivreTokenManager {
  #storedToken: StoredToken | null | undefined;
  #refreshPromise: Promise<string> | null = null;

  public constructor(private readonly options: MercadoLivreTokenManagerOptions) {}

  async getAccessToken(timeoutMs = this.options.timeoutMs): Promise<string | undefined> {
    const stored = await this.loadStoredToken();
    if (!stored) return this.options.accessToken || undefined;
    if (stored.expiresAt > Date.now() + 60_000) return stored.accessToken;
    if (stored.refreshToken && this.options.clientId && this.options.clientSecret) return this.refreshAccessToken(timeoutMs);
    return this.options.accessToken || stored.accessToken;
  }

  async refreshAccessToken(timeoutMs = this.options.timeoutMs): Promise<string> {
    if (!this.#refreshPromise) {
      this.#refreshPromise = this.performRefresh(timeoutMs).finally(() => { this.#refreshPromise = null; });
    }
    const controller = new AbortController();
    try {
      return await Promise.race([
        this.#refreshPromise,
        delay(timeoutMs, undefined, { signal: controller.signal }).then(() => {
          throw new ProviderError("provider_request_timeout", "Mercado Livre token refresh exceeded its deadline", true);
        }),
      ]);
    } finally {
      controller.abort();
    }
  }

  private async loadStoredToken(): Promise<StoredToken | null> {
    if (this.#storedToken !== undefined) return this.#storedToken;
    try {
      const parsed = storedTokenSchema.safeParse(JSON.parse(await readFile(this.options.tokenPath, "utf8")) as unknown);
      if (!parsed.success) throw new ProviderError("mercadolivre_token_file_invalid", parsed.error.message);
      this.#storedToken = parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#storedToken = null;
    }
    return this.#storedToken;
  }

  private async performRefresh(timeoutMs: number): Promise<string> {
    return withTokenFileLock(this.options.tokenPath, timeoutMs, async () => {
      this.#storedToken = undefined;
      const stored = await this.loadStoredToken();
      if (stored && stored.expiresAt > Date.now() + 60_000) return stored.accessToken;
      if (!stored?.refreshToken || !this.options.clientId || !this.options.clientSecret) {
        if (this.options.accessToken) return this.options.accessToken;
        throw new ProviderError("mercadolivre_refresh_unavailable", "Mercado Livre refresh credentials are not configured");
      }
      const response = await requestToken(new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        refresh_token: stored.refreshToken,
      }), timeoutMs);
      const updated: StoredToken = {
        accessToken: response.access_token,
        refreshToken: response.refresh_token ?? stored.refreshToken,
        expiresAt: Date.now() + response.expires_in * 1000,
      };
      await writeStoredToken(this.options.tokenPath, updated);
      this.#storedToken = updated;
      return updated.accessToken;
    });
  }
}
