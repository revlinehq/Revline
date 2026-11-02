import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/** Worktree env files can contain paths copied from another checkout. */
export function workerToolPath(
  configured: string | undefined,
  local: string,
  fallback?: string,
) {
  const checkout = process.cwd();
  const data = configured?.replaceAll("\\", "/").match(/(?:^|\/)\.data\/(.+)$/);
  const candidate = data
    ? join(checkout, ".data", data[1])
    : configured
      ? resolve(checkout, configured)
      : undefined;
  if (candidate && existsSync(candidate)) return candidate;
  const bundled = join(checkout, local);
  if (existsSync(bundled) || !fallback) return bundled;
  return isAbsolute(fallback) ? resolve(fallback) : fallback;
}
