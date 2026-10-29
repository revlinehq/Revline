'use client';

import { useEffect, useMemo, useState } from 'react';
import { highlight } from 'sugar-high';
import { Check, Copy } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { isReactScene } from '@/lib/editor/scene-modules';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import './scene-code-dialog.css';

// Scene code is stored minified. Prettier loads only when the dialog opens; code it cannot parse is shown as stored.
async function formatSceneCode(code: string) {
  const [prettier, babel, estree] = await Promise.all([import('prettier/standalone'), import('prettier/plugins/babel'), import('prettier/plugins/estree')]);
  for (const parser of ['babel', 'babel-ts']) {
    try { return await prettier.format(code, { parser, plugins: [babel, estree], printWidth: 100 }); } catch {}
  }
  return code;
}

export function SceneCodeDialog({ scene, components = [], onClose }: { scene?: { title?: string; code: string }; components?: string[]; onClose: () => void }) {
  const code = scene?.code ?? '';
  const [formatted, setFormatted] = useState<{ source: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!code) return;
    let live = true;
    setCopied(false);
    void formatSceneCode(code).then(text => { if (live) setFormatted({ source: code, text }); });
    return () => { live = false; };
  }, [code]);
  const text = formatted?.source === code ? formatted.text : null;
  const html = useMemo(() => text === null ? '' : highlight(text), [text]);
  const lines = text?.split('\n').length ?? 0;

  return <Dialog open={!!scene} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="flex h-[min(85vh,56rem)] flex-col sm:max-w-5xl">
      <div className="flex flex-col gap-1 pr-8">
        <DialogTitle>{scene?.title || 'Scene'}</DialogTitle>
        <DialogDescription>{isReactScene(code) ? 'React' : 'GSAP'} scene code, {code.length.toLocaleString()} characters{text !== null ? `, ${lines.toLocaleString()} lines` : ''}. Ask the assistant to change it.</DialogDescription>
        {components.length > 0 && <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground"><span>Components</span>{components.map(name => <span key={name} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-foreground/80">{name}</span>)}</div>}
      </div>
      <ScrollArea className="scene-code min-h-0 flex-1 rounded-lg border bg-black/40">
        {text === null
          ? <div className="flex h-40 items-center justify-center gap-2 text-xs text-muted-foreground"><Spinner/>Formatting code</div>
          : <pre className="py-3 pr-4 text-xs leading-relaxed"><code dangerouslySetInnerHTML={{ __html: html }}/></pre>}
      </ScrollArea>
      <Button variant="outline" size="sm" className="self-end" disabled={text === null} onClick={() => { void navigator.clipboard.writeText(text ?? code).then(() => setCopied(true)); }}>{copied ? <Check/> : <Copy/>}{copied ? 'Copied' : 'Copy code'}</Button>
    </DialogContent>
  </Dialog>;
}
