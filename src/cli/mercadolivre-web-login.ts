import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";
import type { BrowserContext } from "playwright";
import { loadConfig } from "../config/env.js";
import { writePrivateJson } from "../utils/private-file.js";

async function main(): Promise<void> {
const config = loadConfig();
const profilePath = resolve(config.MERCADOLIVRE_WEB_PROFILE_PATH);
const storagePath = resolve(config.MERCADOLIVRE_WEB_STORAGE_STATE_PATH);
await mkdir(profilePath, { recursive: true, mode: 0o700 });
await chmod(profilePath, 0o700);
await mkdir(dirname(storagePath), { recursive: true });
let context: BrowserContext | null = null;
let readline: ReturnType<typeof createInterface> | null = null;
try {
  context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    ...(config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  const page = await context.newPage();
  await page.goto("https://lista.mercadolivre.com.br/notebook", { waitUntil: "domcontentloaded" });
  readline = createInterface({ input: stdin, output: stdout });
  await readline.question("Confirme que os resultados do Mercado Livre abriram normalmente e pressione Enter aqui: ");
  const body = await page.locator("body").innerText().catch(() => "");
  if ((await page.title()).length === 0 || /acesso negado|access denied|forbidden/i.test(body)) {
    throw new Error("mercadolivre_web_access_blocked");
  }
  await writePrivateJson(storagePath, await context.storageState());
  stdout.write(`Perfil web do Mercado Livre salvo em ${profilePath}\n`);
} finally {
  readline?.close();
  await context?.close().catch(() => undefined);
}
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : "Falha ao salvar a sessão web do Mercado Livre.");
  process.exitCode = 1;
}
