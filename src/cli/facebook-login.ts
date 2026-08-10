import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium, type Browser } from "playwright";
import { loadConfig } from "../config/env.js";
import { writePrivateJson } from "../utils/private-file.js";

async function main(): Promise<void> {
const config = loadConfig();
const storagePath = resolve(config.FACEBOOK_STORAGE_STATE_PATH);
await mkdir(dirname(storagePath), { recursive: true });

let browser: Browser | null = null;
let readline: ReturnType<typeof createInterface> | null = null;
try {
  browser = await chromium.launch({
    headless: false,
    ...(config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  const context = await browser.newContext({ locale: "pt-BR" });
  const page = await context.newPage();
  await page.goto("https://www.facebook.com/marketplace/", { waitUntil: "domcontentloaded" });
  readline = createInterface({ input: stdin, output: stdout });
  await readline.question("Faça login manualmente no navegador. Quando o Marketplace estiver aberto, pressione Enter aqui: ");
  if (/facebook\.com\/(login|checkpoint)/.test(page.url())) {
    throw new Error("facebook_login_not_completed");
  }
  await writePrivateJson(storagePath, await context.storageState());
  stdout.write(`Sessão salva em ${storagePath}\n`);
} finally {
  readline?.close();
  await browser?.close().catch(() => undefined);
}
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : "Falha ao salvar a sessão do Facebook.");
  process.exitCode = 1;
}
