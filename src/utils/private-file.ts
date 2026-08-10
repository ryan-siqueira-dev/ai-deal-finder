import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export async function writePrivateFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writePrivateFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
