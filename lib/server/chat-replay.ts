import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { parseVideoLink } from "../editor/video-link";
import { workerToolPath } from "./worker-tool-path";
const run = promisify(execFile);
const replay = z.object({
  status: z.string().max(120),
  bins: z
    .array(
      z.object({
        time: z.number().nonnegative(),
        count: z.number().int().nonnegative(),
      }),
    )
    .max(8641),
});
export async function fetchChatReplay(
  url: string,
  duration: number,
  signal: AbortSignal,
  range?: { start: number; end: number },
) {
  if (parseVideoLink(url).kind === "file")
    return JSON.stringify({
      status: "unavailable: direct media has no replay",
      bins: [],
    });
  try {
    const python = workerToolPath(
      process.env.HIGHLIGHT_PYTHON,
      ".data/highlights/bin/python",
    );
    const { stdout } = await run(
      python,
      [
        join(process.cwd(), "scripts/chat-replay.py"),
        url,
        String(range?.start ?? 0),
        String(range?.end ?? duration),
      ],
      { signal, timeout: 50_000, maxBuffer: 1024 * 1024 },
    );
    return JSON.stringify(replay.parse(JSON.parse(stdout)));
  } catch {
    signal.throwIfAborted();
    return JSON.stringify({
      status: "unavailable: replay fetch unsupported or timed out",
      bins: [],
    });
  }
}
