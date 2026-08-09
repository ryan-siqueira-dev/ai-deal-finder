import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";
import { loadConfig } from "../config/env.js";

const config = loadConfig();
const storagePath = resolve(config.FACEBOOK_STORAGE_STATE_PATH);
await mkdir(dirname(storagePath), { recursive: true });

const browser = await chromium.launch({
  headless: false,
  ...(config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});
const context = await browser.newContext({ locale: "pt-BR" });
const page = await context.newPage();
await page.goto("https://www.facebook.com/marketplace/", { waitUntil: "domcontentloaded" });

const readline = createInterface({ input: stdin, output: stdout });
try {
  await readline.question("Faça login manualmente no navegador. Quando o Marketplace estiver aberto, pressione Enter aqui: ");
  if (/facebook\.com\/(login|checkpoint)/.test(page.url())) {
    throw new Error("facebook_login_not_completed");
  }
  await context.storageState({ path: storagePath });
  await chmod(storagePath, 0o600);
  stdout.write(`Sessão salva em ${storagePath}\n`);
} finally {
  readline.close();
  await browser.close();
}
