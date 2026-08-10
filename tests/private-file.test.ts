import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writePrivateFile } from "../src/utils/private-file.js";

describe("writePrivateFile", () => {
  it("atomically creates credential files with owner-only permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deal-finder-private-"));
    const path = join(directory, "credentials.json");
    try {
      await writePrivateFile(path, "secret");
      expect(await readFile(path, "utf8")).toBe("secret");
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
