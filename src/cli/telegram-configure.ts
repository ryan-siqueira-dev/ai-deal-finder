import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writePrivateFile } from "../utils/private-file.js";

const ENV_PATH = ".env";

function readSecret(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) {
    throw new Error("Execute este comando diretamente em um terminal interativo.");
  }
  return new Promise((resolve, reject) => {
    let secret = "";
    const finish = (error?: Error): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(secret.trim());
    };
    const onData = (chunk: Buffer | string): void => {
      for (const character of String(chunk)) {
        if (character === "\u0003") return finish(new Error("Configuração cancelada."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") secret = secret.slice(0, -1);
        else secret += character;
      }
    };
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

async function telegramRequest(token: string, method: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json() as { ok?: boolean; result?: Record<string, unknown>; description?: string };
  if (!response.ok || !payload.ok || !payload.result) throw new Error(payload.description ?? `Telegram recusou ${method}.`);
  return payload.result;
}

async function validateToken(token: string): Promise<string> {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("O token não tem o formato esperado pelo Telegram.");
  const bot = await telegramRequest(token, "getMe");
  if (typeof bot["username"] !== "string") throw new Error("O Telegram não retornou o username do bot.");
  return bot["username"];
}

async function validateChat(token: string, chatId: string): Promise<string> {
  if (!/^(?:-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/.test(chatId)) throw new Error("TELEGRAM_CHAT_ID inválido.");
  const chat = await telegramRequest(token, "getChat", { chat_id: chatId });
  const label = chat["title"] ?? chat["username"] ?? chat["first_name"] ?? chatId;
  return String(label);
}

function setEnvValue(contents: string, name: string, value: string): string {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  return pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
}

async function saveConfiguration(token: string, chatId: string): Promise<void> {
  let current: string;
  try { current = await readFile(ENV_PATH, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    current = await readFile(".env.example", "utf8");
  }
  const updated = setEnvValue(setEnvValue(current, "TELEGRAM_BOT_TOKEN", token), "TELEGRAM_CHAT_ID", chatId);
  await writePrivateFile(ENV_PATH, updated);
}

try {
  const token = await readSecret("Cole o novo token do Telegram (entrada oculta): ");
  const username = await validateToken(token);
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const chatId = (await readline.question("Informe o chat ID (envie uma mensagem ao bot antes): ")).trim();
    const chatLabel = await validateChat(token, chatId);
    await saveConfiguration(token, chatId);
    console.log(`Bot @${username} e chat “${chatLabel}” validados. Configuração salva no .env.`);
  } finally { readline.close(); }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha ao configurar o Telegram.");
  process.exitCode = 1;
}
