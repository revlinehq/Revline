import { execFile, spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { createWriteStream, existsSync } from "node:fs";
import {
  stat,
  statfs,
  readFile,
  readdir,
  writeFile,
  rm,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { parseVideoLink } from "../editor/video-link";
import { AnalysisError, isMediaDiskFull } from "../media-analysis/errors";
import { videoImporterPath } from "./worker-tool-path";
import { z } from "zod";

const run = promisify(execFile);
/** Links have no fixed size cap. Downloading, merging and re-encoding need about
 * four times the file on disk, so the worker's free space sets the ceiling. */
const DISK_PER_IMPORT_BYTE = 4;
const tooLarge = () =>
  new AnalysisError(
    "This video is too large for the media worker to import right now. Upload it as a file instead.",
    400,
  );
const blocked = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(ip, prefix, "ipv4");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2001::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}

/** Resolve once and pin the HTTPS socket to the checked address, preventing DNS rebinding. */
async function videoResponse(
  value: string,
  signal: AbortSignal,
  redirects = 0,
  maxBytes = Infinity,
  headers: Record<string, string> = {},
): Promise<import("node:http").IncomingMessage> {
  const link = parseVideoLink(value);
  if (link.kind !== "file")
    throw new AnalysisError("Use a direct MP4 link for this download.", 400);
  const url = new URL(link.url);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some((item) => !publicAddress(item.address))
  )
    throw new AnalysisError(
      "This link does not point to a public video server.",
      400,
    );
  const selected = addresses.find((item) => item.family === 4) ?? addresses[0];
  const response = await new Promise<import("node:http").IncomingMessage>(
    (resolve, reject) => {
      const req = request(
        url,
        {
          signal,
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [selected]);
            else callback(null, selected.address, selected.family);
          },
          headers: {
            "User-Agent": "Revline/1.0",
            Accept: "video/mp4,application/octet-stream",
            ...headers,
          },
        },
        resolve,
      );
      req.setTimeout(30_000, () =>
        req.destroy(new Error("The video server stopped responding.")),
      );
      req.on("error", reject);
      req.end();
    },
  );
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    response.destroy();
    if (!response.headers.location || redirects >= 5)
      throw new AnalysisError("The video link redirects too many times.", 400);
    return videoResponse(
      new URL(response.headers.location, url).toString(),
      signal,
      redirects + 1,
      maxBytes,
      headers,
    );
  }
  if (response.statusCode !== 200 && response.statusCode !== 206) {
    response.destroy();
    throw new AnalysisError(
      `The video server returned HTTP ${response.statusCode}. Use a public download link.`,
      response.statusCode! >= 500 || [408,429].includes(response.statusCode??0) ? 502 : 400,
    );
  }
  const type = response.headers["content-type"]?.split(";")[0].trim();
  if (
    type &&
    !["video/mp4", "application/octet-stream", "binary/octet-stream"].includes(
      type,
    )
  ) {
    response.destroy();
    throw new AnalysisError(
      "That link opens a webpage instead of an MP4. Use the direct video link.",
      400,
    );
  }
  const size = Number(response.headers["content-length"]);
  if (size > maxBytes) {
    response.destroy();
    throw tooLarge();
  }
  return response;
}

async function downloadMp4(
  url: string,
  path: string,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
  maxBytes: number,
) {
  const checkpointSchema = z.object({
    url: z.string(),
    validator: z.string(),
    total: z.number().positive(),
  });
  const checkpoint = await readFile(`${path}.json`, "utf8")
    .then((value) => checkpointSchema.parse(JSON.parse(value)))
    .catch(() => undefined);
  const size = await stat(path)
    .then((info) => info.size)
    .catch(() => 0);
  if (checkpoint?.url === url && size === checkpoint.total) return;
  const offset = checkpoint?.url === url && size < checkpoint.total ? size : 0;
  const response = await videoResponse(
    url,
    signal,
    0,
    maxBytes,
    offset && checkpoint
      ? { Range: `bytes=${offset}-`, "If-Range": checkpoint.validator }
      : {},
  );
  const resumed = response.statusCode === 206;
  const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
    String(response.headers["content-range"] ?? ""),
  );
  if (
    resumed &&
    (!contentRange ||
      Number(contentRange[1]) !== offset ||
      Number(contentRange[3]) !== checkpoint?.total)
  ) {
    response.destroy();
    throw new Error("The video server returned an invalid resume range.");
  }
  const expected = Number(response.headers["content-length"]);
  const total = resumed ? Number(contentRange![3]) : expected;
  const validator = response.headers.etag ?? response.headers["last-modified"];
  if (!resumed) await rm(path, { force: true });
  if (validator && total > 0)
    await writeFile(`${path}.json`, JSON.stringify({ url, validator, total }));
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (total > 0)
        onProgress(
          Math.min(
            60,
            Math.floor(((received + (resumed ? offset : 0)) / total) * 60),
          ),
        );
      callback(received > maxBytes ? tooLarge() : null, chunk);
    },
  });
  await pipeline(
    response,
    limit,
    createWriteStream(path, { flags: resumed ? "a" : "w" }),
    { signal },
  );
  if (!received || (expected > 0 && expected !== received))
    throw new Error("The video download was incomplete.");
}

export type ImportRange = { start: number; end: number };
type ImportStrategy = {
  name: string;
  fragments: string;
  args: string[];
  youtubeOnly?: boolean;
};
const client = (value: string) => [
  "--force-ipv4",
  "--extractor-args",
  `youtube:player_client=${value}`,
];
/** Tried in order when the site refuses a download. Each one reaches the video
 * a different way; all were checked against yt-dlp 2026.10.26 on 2026-11-09.
 * The last one only offers 360p, so it stays last. */
const IMPORT_STRATEGIES: ImportStrategy[] = [
  { name: "default", fragments: "4", args: [] },
  { name: "ipv4-single", fragments: "1", args: ["--force-ipv4"] },
  {
    name: "web_embedded",
    fragments: "1",
    args: client("web_embedded"),
    youtubeOnly: true,
  },
  {
    name: "web_safari",
    fragments: "1",
    args: client("web_safari"),
    youtubeOnly: true,
  },
  {
    name: "mobile-360p",
    fragments: "1",
    args: client("mweb,tv_simply,android"),
    youtubeOnly: true,
  },
];
/** The strategy that last worked on this worker goes first next time. */
let preferredStrategy = IMPORT_STRATEGIES[0];
/** Nothing another client or route can fix. */
const PERMANENT_REFUSAL =
  /private video|video unavailable|has been removed|copyright|age.restricted|confirm your age|members.only|not available in your country/i;
/** The site answered but would not hand over the media: another client, format or route may work. */
const SITE_REFUSAL =
  /HTTP Error 40[13]|HTTP Error 429|unable to download video data|sign in|confirm.*bot|requested format.*not available|no video formats|needs to be reloaded|po.?token/i;

const DAY = 24 * 3600_000;
let importer:
  | { at: number; ready: Promise<{ version: string; pythonPath?: string }> }
  | undefined;
/** The image bakes a pinned yt-dlp, and sites change faster than images are
 * rebuilt. Where VIDEO_IMPORT_AUTO_UPDATE is set (the processor image), the
 * newest release is installed into scratch space once a day and loaded ahead
 * of the baked copy; any failure keeps the baked one. Nothing under /opt is
 * written, so this works as the unprivileged `node` user. */
async function prepareImporter() {
  const executable = videoImporterPath();
  const version = (pythonPath?: string) =>
    run(executable, ["--version"], {
      timeout: 20_000,
      env: { ...process.env, ...(pythonPath ? { PYTHONPATH: pythonPath } : {}) },
    }).then((result) => result.stdout.trim());
  const baked = await version().catch(() => "unavailable");
  if (!/^(1|true)$/i.test(process.env.VIDEO_IMPORT_AUTO_UPDATE ?? ""))
    return { version: baked };
  const target = join(tmpdir(), `revline-yt-dlp-${process.pid}-${Date.now()}`);
  try {
    await run(
      join(dirname(executable), "python"),
      [
        "-m",
        "pip",
        "install",
        "--quiet",
        "--disable-pip-version-check",
        "--no-cache-dir",
        "--upgrade",
        "--target",
        target,
        "yt-dlp",
        "yt-dlp-ejs",
      ],
      { timeout: 90_000 },
    );
    const updated = await version(target);
    // Versions are zero-padded dates (2026.10.26), so text order is release order.
    if (!/^\d/.test(baked) || updated > baked)
      return { version: updated, pythonPath: target };
  } catch {
    /* Offline or no pip: the baked version still works. */
  }
  await rm(target, { recursive: true, force: true }).catch(() => {});
  return { version: baked };
}
/** Version in use, for readiness logs and failure messages. Refreshes daily. */
export function videoImporter() {
  if (!importer || Date.now() - importer.at > DAY) {
    const previous = importer?.ready;
    const ready = prepareImporter();
    importer = { at: Date.now(), ready };
    // Drop the scratch copy the new one replaces, so a long-lived worker keeps one.
    void Promise.all([previous, ready])
      .then(([old, next]) =>
        old?.pythonPath && old.pythonPath !== next.pythonPath
          ? rm(old.pythonPath, { recursive: true, force: true })
          : undefined,
      )
      .catch(() => {});
  }
  return importer.ready;
}
/** Any length imports. With a range, only that window downloads, cut on exact frames. */
function youtubeArguments(
  url: string,
  path: string,
  maxBytes: number,
  range: ImportRange | undefined,
  strategy: ImportStrategy,
) {
  const window = range
    ? [
        "--download-sections",
        `*${range.start}-${range.end}`,
        "--force-keyframes-at-cuts",
      ]
    : [];
  return [
    "--ignore-config",
    "--no-plugin-dirs",
    "--no-playlist",
    "--no-warnings",
    "--continue",
    "--no-overwrites",
    "--socket-timeout",
    "30",
    "--retries",
    "2",
    "--fragment-retries",
    "2",
    "--concurrent-fragments",
    strategy.fragments,
    "--extractor-retries",
    "2",
    "--retry-sleep",
    "exp=1:4",
    "--max-filesize",
    String(maxBytes),
    "--match-filters",
    range ? `duration > ${range.start} & !is_live` : "!is_live",
    ...window,
    ...strategy.args,
    ...(process.env.VIDEO_IMPORT_PROXY
      ? ["--proxy", process.env.VIDEO_IMPORT_PROXY]
      : []),
    "--js-runtimes",
    `node:${process.execPath}`,
    "-f",
    "bv*[height<=1080]+ba/b[height<=1080]/best",
    "--merge-output-format",
    "mp4",
    "--remux-video",
    "mp4",
    "--print",
    "after_move:%(title)s",
    "-o",
    path,
    "--",
    url,
  ];
}

function downloadYoutube(
  executable: string,
  args: string[],
  signal: AbortSignal,
  pythonPath?: string,
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      signal,
      stdio: ["ignore", "pipe", "pipe"],
      ...(pythonPath
        ? { env: { ...process.env, PYTHONPATH: pythonPath } }
        : {}),
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-8192);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(
            Object.assign(new Error("The downloader did not finish."), {
              stderr,
            }),
          ),
    );
  });
}

export async function importVideoLink(
  value: string,
  directory: string,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
  range?: ImportRange,
) {
  const link = parseVideoLink(value);
  const prepared = z.object({
    fileName: z.string(),
    duration: z.number().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
  });
  const saved = await readFile(join(directory, "prepared.json"), "utf8")
    .then((value) => prepared.parse(JSON.parse(value)))
    .catch(() => undefined);
  if (saved && existsSync(join(directory, "video.mp4")))
    return { path: join(directory, "video.mp4"), ...saved };
  if (range && (!(range.start >= 0) || !(range.end > range.start)))
    throw new AnalysisError("An imported range must end after it starts.", 400);
  const disk = await statfs(directory);
  const maxBytes = Math.floor(
    (disk.bavail * disk.bsize) / DISK_PER_IMPORT_BYTE,
  );
  if (maxBytes < 64 * 1024 * 1024)
    throw new AnalysisError(
      "The media worker needs more free disk space before importing a video.",
      503,
      false,
    );
  const source = join(directory, "download.mp4");
  let title = "Imported video";
  if (link.kind !== "file") {
    const executable = videoImporterPath();
    const { version, pythonPath } = await videoImporter();
    const strategies = [
      preferredStrategy,
      ...IMPORT_STRATEGIES.filter((item) => item !== preferredStrategy),
    ].filter((item) => link.kind === "youtube" || !item.youtubeOnly);
    const refusals: string[] = [];
    for (const strategy of strategies) {
      try {
        const stdout = await downloadYoutube(
          executable,
          youtubeArguments(link.url, source, maxBytes, range, strategy),
          signal,
          pythonPath,
        );
        title = stdout.trim().split("\n").at(-1) || title;
        preferredStrategy = strategy;
        if (refusals.length)
          console.log(
            `Video import: strategy "${strategy.name}" worked after ${refusals.length} refused (yt-dlp ${version}).`,
          );
        break;
      } catch (error) {
        if (signal.aborted || isMediaDiskFull(error)) throw error;
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new AnalysisError(
            "Video-link import is unavailable on this media worker. Install yt-dlp first.",
            503,
          );
        const stderr = String((error as { stderr?: string }).stderr ?? "");
        const reason =
          stderr
            .replace(/https?:\/\/\S+/g, "[video URL]")
            .split("\n")
            .filter((line) => line.startsWith("ERROR"))
            .at(-1)
            ?.slice(0, 300) ?? "The downloader returned no diagnostic.";
        if (PERMANENT_REFUSAL.test(stderr))
          throw new AnalysisError(
            "The video provider blocked this download. Use a public MP4 link or upload the video file instead.",
            400,
          );
        if (/unsupported url/i.test(stderr))
          throw new AnalysisError(
            "This link has no downloadable video format.",
            422,
          );
        if (!SITE_REFUSAL.test(stderr))
          throw new AnalysisError(
            `Video-link download failed (yt-dlp ${version}): ${reason}`,
            502,
          );
        refusals.push(`${strategy.name}: ${reason}`);
        // The raw lines stay in the worker log; the user gets the plain sentence below.
        console.warn(
          `Video import: strategy "${strategy.name}" refused (yt-dlp ${version}): ${reason}`,
        );
        // Another client picks other formats, so earlier partial files cannot resume.
        for (const name of await readdir(directory))
          if (name.startsWith("download."))
            await rm(join(directory, name), { force: true });
      }
    }
    if (refusals.length === strategies.length)
      throw new AnalysisError(
        `The video site refused this download from our servers, so the link could not be imported. Download the video on your device and upload the file instead. (Ref: yt-dlp ${version}, ${refusals.length} ways tried, ${/HTTP Error \d+/.exec(refusals.at(-1)!)?.[0] ?? "refused"}.)`,
        400,
      );
  } else {
    await downloadMp4(link.url, source, signal, onProgress, maxBytes);
    try {
      title = decodeURIComponent(
        new URL(link.url).pathname.split("/").at(-1) || title,
      ).replace(/\.mp4$/i, "");
    } catch {
      /* A safe default name works too. */
    }
  }
  if (!existsSync(source))
    throw new AnalysisError(
      range
        ? "This video-link import did not produce a file. The link must be public, not a livestream, and longer than the range start."
        : "This video-link import did not produce a file. Links must be public and not livestreams.",
      400,
    );
  if ((await stat(source)).size > maxBytes) throw tooLarge();
  onProgress(65);
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height,pix_fmt",
      "-of",
      "json",
      source,
    ],
    { signal, timeout: 30_000, maxBuffer: 1024 * 1024 },
  ).catch(() => {
    throw new AnalysisError(
      "The link did not contain a readable MP4 video.",
      400,
    );
  });
  const metadata = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
    }[];
  };
  const video = metadata.streams?.find(
    (stream) => stream.codec_type === "video",
  );
  const audio = metadata.streams?.find(
    (stream) => stream.codec_type === "audio",
  );
  // A direct MP4 arrives whole, so its range is cut here; YouTube already downloaded only the range.
  const cut = range && link.kind === "file" ? range : undefined;
  const fullDuration = Number(metadata.format?.duration);
  const duration = cut
    ? Math.min(fullDuration, cut.end) - cut.start
    : fullDuration;
  if (cut && fullDuration <= cut.start)
    throw new AnalysisError(
      "The import range starts after the end of this video.",
      400,
    );
  if (
    !video?.width ||
    !video.height ||
    video.width > 16384 ||
    video.height > 16384 ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    throw new AnalysisError("The link did not contain a readable video.", 400);
  const path = join(directory, "video.mp4");
  const copyVideo =
    !cut && video.codec_name === "h264" && video.pix_fmt === "yuv420p";
  // Keep supported streams intact; convert other codecs for browser preview and export. A cut re-encodes so it lands on exact frames.
  if (copyVideo && (!audio || audio.codec_name === "aac"))
    await rename(source, path);
  else
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        ...(cut ? ["-ss", String(cut.start), "-to", String(cut.end)] : []),
        "-i",
        source,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        ...(copyVideo
          ? ["-c:v", "copy"]
          : [
              "-vf",
              "scale=trunc(iw/2)*2:trunc(ih/2)*2",
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "20",
              "-pix_fmt",
              "yuv420p",
            ]),
        "-c:a",
        audio?.codec_name === "aac" ? "copy" : "aac",
        "-movflags",
        "+faststart",
        "-y",
        path,
      ],
      { signal, maxBuffer: 1024 * 1024 },
    );
  await rm(source, { force: true });
  onProgress(80);
  const fileName = `${
    title
      .replace(/[\x00-\x1f/\\]/g, "")
      .trim()
      .slice(0, 180) || "Imported video"
  }.mp4`;
  const result = {
    fileName,
    duration,
    width: copyVideo ? video.width : Math.floor(video.width / 2) * 2,
    height: copyVideo ? video.height : Math.floor(video.height / 2) * 2,
  };
  await writeFile(join(directory, "prepared.json"), JSON.stringify(result));
  return { path, ...result };
}
