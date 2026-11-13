import { createServer, type AddressInfo } from "node:net";
import { connect } from "node:tls";

/**
 * VIDEO_IMPORT_PROXY may be an HTTPS proxy (TLS to the proxy itself, e.g. one behind Tailscale Funnel).
 * yt-dlp's own requests can use one, but ffmpeg (range imports via --download-sections) cannot and
 * silently connects directly instead. So for an https:// proxy this starts a local bridge that wraps
 * each connection in TLS to the proxy, and yt-dlp and ffmpeg get a plain http://127.0.0.1 proxy.
 * The credentials stay in the URL, so the proxy still sees them as Proxy-Authorization.
 */
let bridge: Promise<string> | undefined;

export function importProxyUrl(): Promise<string | undefined> {
  const value = process.env.VIDEO_IMPORT_PROXY;
  if (!value) return Promise.resolve(undefined);
  let upstream: URL;
  try {
    upstream = new URL(value);
  } catch {
    return Promise.resolve(value);
  }
  if (upstream.protocol !== "https:") return Promise.resolve(value);
  bridge ??= startBridge(upstream).catch((error) => {
    bridge = undefined;
    throw error;
  });
  return bridge;
}

function startBridge(upstream: URL) {
  const host = upstream.hostname;
  const port = Number(upstream.port) || 443;
  const server = createServer((local) => {
    const remote = connect({ host, port, servername: host });
    const close = () => {
      local.destroy();
      remote.destroy();
    };
    local.on("error", close).on("close", close);
    remote.on("error", close).on("close", close);
    local.pipe(remote).pipe(local);
  });
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      const { port: local } = server.address() as AddressInfo;
      const auth = upstream.username
        ? `${upstream.username}${upstream.password ? `:${upstream.password}` : ""}@`
        : "";
      resolve(`http://${auth}127.0.0.1:${local}`);
    });
  });
}
