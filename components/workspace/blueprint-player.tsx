'use client';
import { useEffect, useRef, useState } from 'react';
import type { SceneBrand } from '@/lib/editor/brand-kit';

type Brand = Omit<SceneBrand, 'fonts'> & { fonts: { family: string; weight: string; role: string; url: string }[] };

let runtime: Promise<string> | null = null, icons: Promise<Record<string, string>> | null = null;
const runtimeText = () => runtime ??= fetch('/vendor/scene-runtime.js').then(response => response.text()).then(text => text.replace(/<\/script/gi, '<\\/script'));
const iconSet = () => icons ??= fetch('/vendor/lucide-icons.json').then(async (response): Promise<Record<string, string>> => response.ok ? response.json() : {}).catch((): Record<string, string> => ({}));
const buffer = (url: string) => fetch(url).then(async response => { if (!response.ok) throw new Error(String(response.status)); const blob = await response.blob(); return { type: blob.type, data: await blob.arrayBuffer() }; });

/** The scene frame the editor uses: no network, so fonts, screens and icons are sent in. */
function frameDocument(width: number, height: number, script: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: blob:"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent}body{font-family:Arial,sans-serif;-webkit-font-smoothing:antialiased}#scene-root{position:absolute;inset:0;overflow:hidden}</style></head><body><div id="scene-root"></div><script>${script}</script></body></html>`;
}

/** A blueprint rendered live by the scene runtime at width x height, scaled to fit its container. */
export function BlueprintPlayer({ code, brand, width, height, time = 0, onReady }: { code: string; brand: Brand | null; width: number; height: number; time?: number; onReady?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null), box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    const element = box.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
    observer.observe(element); return () => observer.disconnect();
  }, [width]);
  useEffect(() => {
    let live = true; setError('');
    const target = frame.current; if (!target) return;
    const send = (message: object) => target.contentWindow?.postMessage({ source: 'revline-scene-host', ...message }, '*');
    const onMessage = async (event: MessageEvent) => {
      const data = event.data; if (event.source !== target.contentWindow || data?.source !== 'revline-scene') return;
      if (data.type === 'ready') {
        const names = [...code.matchAll(/['"`]([a-z0-9]+(?:-[a-z0-9]+)*)['"`]/g)].map(match => match[1]);
        const [fonts, media, all] = await Promise.all([
          Promise.all((brand?.fonts ?? []).filter(font => code.includes(font.family)).map(font => buffer(font.url).then(file => ({ family: font.family, weight: font.weight, data: file.data }), () => null))),
          Promise.all((brand?.screens ?? []).map(screen => buffer(screen.url).then(file => ({ name: screen.name, ...file }), () => null))),
          iconSet(),
        ]);
        if (!live) return;
        send({ type: 'init', code, brand, width, height, fps: 30, duration: Math.max(1, time + 1), fonts: fonts.filter(Boolean), media: media.filter(Boolean), icons: Object.fromEntries(names.filter(name => all[name] !== undefined).map(name => [name, all[name]])) });
      } else if (data.type === 'compiled') send({ type: 'seek', time, seq: 1 });
      else if (data.type === 'painted') onReady?.();
      else if (data.type === 'error') setError(String(data.message));
    };
    window.addEventListener('message', onMessage);
    void runtimeText().then(script => { if (live) target.srcdoc = frameDocument(width, height, script); }, () => setError('The renderer could not load.'));
    return () => { live = false; window.removeEventListener('message', onMessage); };
  }, [code, brand, width, height, time, onReady]);
  return <div ref={box} className="blueprint-player" style={{ aspectRatio: `${width} / ${height}` }}>
    <iframe ref={frame} title="Blueprint" sandbox="allow-scripts" tabIndex={-1} style={{ width, height, transform: `scale(${scale})` }} />
    {error && <p className="blueprint-error" role="alert">{error}</p>}
  </div>;
}
