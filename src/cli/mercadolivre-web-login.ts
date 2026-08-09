import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";
import { loadConfig } from "../config/env.js";

const config = loadConfig();
const profilePath = resolve(config.MERCADOLIVRE_WEB_PROFILE_PATH);
const storagePath = resolve(config.MERCADOLIVRE_WEB_STORAGE_STATE_PATH);
await mkdir(dirname(profilePath), { recursive: true });

const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
  ...(config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: config.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});
const page = await context.newPage();
await page.goto("https://lista.mercadolivre.com.br/notebook", { waitUntil: "domcontentloaded" });

const readline = createInterface({ input: stdin, output: stdout });
try {
  await readline.question("Confirme que os resultados do Mercado Livre abriram normalmente e pressione Enter aqui: ");
  const body = await page.locator("body").innerText().catch(() => "");
  if ((await page.title()).length === 0 || /acesso negado|access denied|forbidden/i.test(body)) {
    throw new Error("mercadolivre_web_access_blocked");
  }
  await context.storageState({ path: storagePath });
  await chmod(storagePath, 0o600);
  await chmod(profilePath, 0o700);
  stdout.write(`Perfil web do Mercado Livre salvo em ${profilePath}\n`);
} finally {
  readline.close();
  await context.close();
}
