import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";
import { loadConfig } from "../config/env.js";

const config = loadConfig();
const storagePath = resolve(config.OLX_STORAGE_STATE_PATH);
await mkdir(dirname(storagePath), { recursive: true });

const browser = await chromium.launch({
  headless: false,
  ...(config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});
const context = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await context.newPage();
await page.goto("https://www.olx.com.br/", { waitUntil: "domcontentloaded" });

const readline = createInterface({ input: stdin, output: stdout });
try {
  await readline.question("Confirme que a OLX abriu normalmente (faça login se desejar) e pressione Enter aqui: ");
  const title = await page.title();
  const blocked = /cloudflare|attention required/i.test(title)
    || await page.getByText(/sorry, you have been blocked|unable to access olx\.com\.br/i).first().isVisible().catch(() => false);
  if (blocked) throw new Error("olx_access_still_blocked");
  await context.storageState({ path: storagePath });
  await chmod(storagePath, 0o600);
  stdout.write(`Sessão OLX salva em ${storagePath}\n`);
} finally {
  readline.close();
  await browser.close();
}
