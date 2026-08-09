import { chmod, readFile, writeFile } from "node:fs/promises";

const ENV_PATH = ".env";

function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("Execute este comando diretamente em um terminal interativo.");
  }

  return new Promise((resolve, reject) => {
    let secret = "";
    const finish = (error?: Error): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
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

    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
  });
}

async function validateToken(token: string): Promise<string> {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("O token não tem o formato esperado pelo Telegram.");
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(15_000) });
  const body = await response.json() as { ok?: boolean; result?: { username?: string }; description?: string };
  if (!response.ok || !body.ok || !body.result?.username) throw new Error(body.description ?? "O Telegram recusou o token.");
  return body.result.username;
}

async function saveToken(token: string): Promise<void> {
  const current = await readFile(ENV_PATH, "utf8");
  const line = `TELEGRAM_BOT_TOKEN=${token}`;
  const updated = /^TELEGRAM_BOT_TOKEN=.*$/m.test(current)
    ? current.replace(/^TELEGRAM_BOT_TOKEN=.*$/m, line)
    : `${current.trimEnd()}\n${line}\n`;
  await writeFile(ENV_PATH, updated, { mode: 0o600 });
  await chmod(ENV_PATH, 0o600);
}

try {
  const token = await readSecret("Cole o novo token do Telegram (entrada oculta): ");
  const username = await validateToken(token);
  await saveToken(token);
  console.log(`Bot @${username} validado. Token salvo com segurança no .env.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha ao configurar o Telegram.");
  process.exitCode = 1;
}
