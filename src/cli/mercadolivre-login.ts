import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig } from "../config/env.js";
import { exchangeMercadoLivreAuthorizationCode } from "../marketplaces/mercadolivre/auth.js";

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} não está configurado no .env`);
  return value.trim();
}

function normalizedCallback(value: URL): string {
  return `${value.origin}${value.pathname.replace(/\/$/, "")}`;
}

const config = loadConfig();
const credentials = {
  clientId: required(config.MERCADOLIVRE_CLIENT_ID, "MERCADOLIVRE_CLIENT_ID"),
  clientSecret: required(config.MERCADOLIVRE_CLIENT_SECRET, "MERCADOLIVRE_CLIENT_SECRET"),
  redirectUri: required(config.MERCADOLIVRE_REDIRECT_URI, "MERCADOLIVRE_REDIRECT_URI"),
};
const state = randomBytes(24).toString("base64url");
const codeVerifier = randomBytes(64).toString("base64url");
const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
const authorizationUrl = new URL("https://auth.mercadolivre.com.br/authorization");
authorizationUrl.search = new URLSearchParams({
  response_type: "code",
  client_id: credentials.clientId,
  redirect_uri: credentials.redirectUri,
  state,
  code_challenge: codeChallenge,
  code_challenge_method: "S256",
}).toString();

stdout.write("Abra esta URL no navegador e autorize a aplicação:\n\n");
stdout.write(`${authorizationUrl.toString()}\n\n`);
const readline = createInterface({ input: stdin, output: stdout });
try {
  const callbackValue = await readline.question("Depois do redirecionamento, cole aqui a URL completa exibida no navegador: ");
  const callback = new URL(callbackValue.trim());
  if (normalizedCallback(callback) !== normalizedCallback(new URL(credentials.redirectUri))) {
    throw new Error("mercadolivre_callback_uri_mismatch");
  }
  if (callback.searchParams.get("state") !== state) throw new Error("mercadolivre_oauth_state_mismatch");
  const oauthError = callback.searchParams.get("error");
  if (oauthError) throw new Error(`mercadolivre_authorization_failed:${oauthError}`);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("mercadolivre_authorization_code_missing");
  await exchangeMercadoLivreAuthorizationCode({
    credentials,
    code,
    codeVerifier,
    tokenPath: config.MERCADOLIVRE_TOKEN_PATH,
    timeoutMs: config.PROVIDER_REQUEST_TIMEOUT_MS,
  });
  stdout.write(`Autorização concluída. Tokens salvos com acesso restrito em ${config.MERCADOLIVRE_TOKEN_PATH}.\n`);
} finally {
  readline.close();
}
