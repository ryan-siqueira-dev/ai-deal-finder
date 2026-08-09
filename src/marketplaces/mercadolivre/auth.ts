import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
  }, { timeoutMs, retries: 1, baseDelayMs: 750 });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 500);
    throw new ProviderError("mercadolivre_oauth_failed", `Mercado Livre OAuth returned ${response.status}: ${message}`);
  }
  const parsed = oauthTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new ProviderError("mercadolivre_oauth_invalid_response", parsed.error.message);
  return parsed.data;
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
}

export class MercadoLivreTokenManager {
  #storedToken: StoredToken | null | undefined;
  #refreshPromise: Promise<string> | null = null;

  public constructor(private readonly options: MercadoLivreTokenManagerOptions) {}

  async getAccessToken(): Promise<string | undefined> {
    const stored = await this.loadStoredToken();
    if (!stored) return this.options.accessToken || undefined;
    if (stored.expiresAt > Date.now() + 60_000) return stored.accessToken;
    if (stored.refreshToken && this.options.clientId && this.options.clientSecret) return this.refreshAccessToken();
    return stored.accessToken;
  }

  async refreshAccessToken(): Promise<string> {
    if (!this.#refreshPromise) {
      this.#refreshPromise = this.performRefresh().finally(() => { this.#refreshPromise = null; });
    }
    return this.#refreshPromise;
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

  private async performRefresh(): Promise<string> {
    const stored = await this.loadStoredToken();
    if (!stored?.refreshToken || !this.options.clientId || !this.options.clientSecret) {
      throw new ProviderError("mercadolivre_refresh_unavailable", "Mercado Livre refresh credentials are not configured");
    }
    const response = await requestToken(new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      refresh_token: stored.refreshToken,
    }), this.options.timeoutMs);
    const updated: StoredToken = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? stored.refreshToken,
      expiresAt: Date.now() + response.expires_in * 1000,
    };
    await writeStoredToken(this.options.tokenPath, updated);
    this.#storedToken = updated;
    return updated.accessToken;
  }
}
