import { createHash } from "node:crypto";
import { mkdir, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Download fragments survive a worker restart. Active imports refresh their
 * marker; abandoned checkpoints are reclaimed without touching running work. */
export async function importCheckpoint(backend: string, taskId: string) {
  const root = join(
    process.cwd(),
    ".data",
    "imports",
    createHash("sha256").update(backend).digest("hex"),
  );
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === taskId) continue;
    const path = join(root, entry.name),
      marker = await stat(join(path, ".active")).catch(() => null);
    if (marker && Date.now() - marker.mtimeMs > 24 * 60 * 60_000)
      await rm(path, { recursive: true, force: true });
  }
  const directory = join(root, taskId),
    marker = join(directory, ".active");
  await mkdir(directory, { recursive: true });
  await writeFile(marker, "");
  const timer = setInterval(() => {
    void utimes(marker, new Date(), new Date()).catch(() => {});
  }, 20_000);
  timer.unref();
  return { directory, close: () => clearInterval(timer) };
}
