'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, AudioLines, Check, Download, ExternalLink, FileJson, FlaskConical, Layers3, Pause, Play, RotateCcw, Save, Settings2, Sparkles, Upload, X } from 'lucide-react';
import { ColorControl } from '@/components/editor/color-control';
import { PrimaryButton } from '@/components/workspace/primary-button';
import { REMOTION_TEXT_LABELS, REMOTION_TEXT_PRESETS } from '@/lib/editor/remotion-text';
import { SubjectToolsLab } from './subject-tools-lab';
import { RemotionLabScene } from './remotion-lab-scenes';
import { alignLabItems, DEFAULT_LAB_CONFIG, LAB_CATEGORIES, LAB_SCENES, LAB_TEMPLATES, labTemplateFile, parseLabConfig, parseLabFile, retimeWords, type LabCategory, type LabConfig, type LabItem, type LabTemplate, type LabWord } from './remotion-lab-model';
import './remotion-dev-tests.css';

const STORAGE_KEY = 'revline:remotion-lab:templates:v1';
const cloneConfig = (config: LabConfig) => ({ ...config, items: config.items.map(item => ({ ...item })), words: config.words.map(word => ({ ...word })) });
type LocalAudio = { name: string; url: string };

function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="rmlab-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function RangeField({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  return <label className="rmlab-range-field"><span>{label}<output>{value}{unit}</output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/></label>;
}

function Preview({ config, frame }: { config: LabConfig; frame: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const dimensions = config.aspect === 'landscape' ? [960, 540] : [540, 960];
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div className="rmlab-preview" ref={host} style={{ aspectRatio: `${dimensions[0]}/${dimensions[1]}` }} aria-label={`${config.scene} animation preview`}>
    <div className="rmlab-artboard" style={{ width: dimensions[0], height: dimensions[1], transform: `scale(${width / dimensions[0]})`, visibility: width ? 'visible' : 'hidden' }}><RemotionLabScene config={config} frame={frame}/></div>
  </div>;
}

function Timeline({ config, frame, onSeek }: { config: LabConfig; frame: number; onSeek: (frame: number) => void }) {
  const max = Math.round(config.duration * config.fps) - 1;
  return <div className="rmlab-timeline">
    <div className="rmlab-timeline-ruler"><span>0s</span><span>{(config.duration / 2).toFixed(1)}s</span><span>{config.duration.toFixed(1)}s</span></div>
    <div className="rmlab-timeline-track" style={{ '--lab-playhead': `${frame / max * 100}%` } as CSSProperties}>
      {config.items.map((item, index) => <button key={index} type="button" className="rmlab-cue-marker" title={`${item.label}: ${item.start.toFixed(2)} seconds`} aria-label={`Seek to ${item.label} at ${item.start.toFixed(2)} seconds`} style={{ left: `${item.start / config.duration * 100}%` }} onClick={() => onSeek(Math.round(item.start * config.fps))}><i/>{index + 1}</button>)}
      <i className="rmlab-playhead"/>
    </div>
    <input className="rmlab-seek" type="range" aria-label="Preview frame" min={0} max={max} value={frame} onChange={event => onSeek(Number(event.target.value))}/>
  </div>;
}

function ItemControls({ config, onChange, onSeek }: { config: LabConfig; onChange: (patch: Partial<LabConfig>) => void; onSeek: (frame: number) => void }) {
  const [open, setOpen] = useState(0);
  function update(index: number, patch: Partial<LabItem>) { onChange({ items: config.items.map((item, i) => i === index ? { ...item, ...patch } : item) }); }
  return <div className="rmlab-item-controls">{config.items.map((item, index) => <div className="rmlab-item-editor" key={index}>
    <button type="button" className="rmlab-item-toggle" aria-expanded={open === index} onClick={() => setOpen(open === index ? -1 : index)}><span className="rmlab-item-index">0{index + 1}</span><strong>{item.label || `Item ${index + 1}`}</strong><span>{item.start.toFixed(2)}s</span><Settings2 size={13}/></button>
    {open === index ? <div className="rmlab-item-fields">
      <Field label="Label"><input value={item.label} maxLength={60} onChange={event => update(index, { label: event.target.value })}/></Field>
      <Field label="Description"><input value={item.detail} maxLength={120} onChange={event => update(index, { detail: event.target.value })}/></Field>
      <div className="rmlab-field-pair"><Field label={config.scene === 'counter' ? 'Target number' : 'Value'}><input type="number" min={0} max={1e12} value={item.value} onChange={event => update(index, { value: Math.min(1e12, Math.max(0, Number(event.target.value))) })}/></Field>
        <Field label="Appears at (s)"><input type="number" step="0.05" min={0} max={config.duration} value={item.start} onChange={event => update(index, { start: Math.min(config.duration, Math.max(0, Number(event.target.value))) })}/></Field></div>
      <Field label="Trigger word" hint="Match a word in your timed transcript."><input value={item.trigger} maxLength={60} onChange={event => update(index, { trigger: event.target.value })}/></Field>
      <button type="button" className="rmlab-button rmlab-button-small" onClick={() => onSeek(Math.min(Math.round(config.duration * config.fps) - 1, Math.round(item.start * config.fps)))}><Play size={12}/>Jump to cue</button>
    </div> : null}
  </div>)}</div>;
}

function SpeechControls({ config, onChange, onSeek, audio, onAudio, onRemoveAudio, onNotice }: { config: LabConfig; onChange: (patch: Partial<LabConfig>) => void; onSeek: (frame: number) => void; audio: LocalAudio | null; onAudio: (file: File) => void; onRemoveAudio: () => void; onNotice: (notice: string) => void }) {
  const [selectedWord, setSelectedWord] = useState(0);
  const word = config.words[selectedWord];
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  function updateWord(patch: Partial<LabWord>) {
    if (!word) return;
    const next = { ...word, ...patch };
    const previous = config.words[selectedWord - 1], following = config.words[selectedWord + 1];
    next.start = Math.min(next.end, Math.max(previous?.end ?? 0, next.start));
    next.end = Math.max(next.start, Math.min(following?.start ?? config.duration, next.end));
    onChange({ words: config.words.map((value, index) => index === selectedWord ? next : value) });
  }
  async function importTimings(file: File) {
    try {
      if (file.size > 500_000) throw new Error('Choose a timing file smaller than 500 KB.');
      const json = JSON.parse(await file.text());
      const words = Array.isArray(json) ? json : json.words;
      const checked = parseLabConfig({ ...config, words });
      onChange({ words: checked.words }); setSelectedWord(0); onNotice('Word timings imported. Align the card triggers when you are ready.');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'That timing file could not be read.'); }
  }
  return <div className="rmlab-speech-controls">
    <p className="rmlab-help">Starts with an editable sample transcript. Add your voiceover and adjust the word times, or import timed words. No speech detection runs here.</p>
    <div className="rmlab-audio-control">{audio ? <><AudioLines size={16}/><span title={audio.name}>{audio.name}</span><button type="button" className="rmlab-icon-button" aria-label="Remove voiceover" onClick={onRemoveAudio}><X size={14}/></button></> : <button type="button" className="rmlab-button" onClick={() => audioRef.current?.click()}><Upload size={14}/>Add local voiceover</button>}</div>
    <input ref={audioRef} hidden type="file" accept="audio/*" onChange={event => { const file = event.target.files?.[0]; if (file) onAudio(file); event.target.value = ''; }}/>
    <Field label="Transcript" hint="Changing the sentence distributes sample word times across the duration."><textarea rows={3} maxLength={2000} value={config.words.map(word => word.word).join(' ')} onChange={event => { onChange({ words: retimeWords(event.target.value, config.duration) }); setSelectedWord(0); }}/></Field>
    <div className="rmlab-word-cues" aria-label="Transcript words">{config.words.map((cue, index) => <button key={index} type="button" data-selected={index === selectedWord} onClick={() => { setSelectedWord(index); onSeek(Math.round(cue.start * config.fps)); }} title={`${cue.start.toFixed(2)}–${cue.end.toFixed(2)}s`}>{cue.word}<small>{cue.start.toFixed(2)}</small></button>)}</div>
    {word ? <div className="rmlab-field-pair"><Field label={`“${word.word}” starts (s)`}><input type="number" step="0.05" min={config.words[selectedWord - 1]?.end ?? 0} max={word.end} value={word.start} onChange={event => updateWord({ start: Number(event.target.value) })}/></Field><Field label="Ends (s)"><input type="number" step="0.05" min={word.start} max={config.words[selectedWord + 1]?.start ?? config.duration} value={word.end} onChange={event => updateWord({ end: Number(event.target.value) })}/></Field></div> : null}
    <div className="rmlab-button-row"><button type="button" className="rmlab-button" onClick={() => { onChange({ items: alignLabItems(config) }); onNotice('Matching card triggers now use their transcript word times.'); }}><Sparkles size={13}/>Align card triggers</button><button type="button" className="rmlab-button" onClick={() => fileRef.current?.click()}><FileJson size={13}/>Import words</button></div>
    <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) void importTimings(file); event.target.value = ''; }}/>
    <details className="rmlab-format"><summary>Timing file format</summary><code>{'{"words":[{"word":"Products","start":1.8,"end":2.7}]}'}</code><p>Seconds, relative to the clip. Times must be ordered, with one entry per word. Voiceover stays in this browser tab.</p></details>
    <label className="rmlab-check"><input type="checkbox" checked={config.showTranscript} onChange={event => onChange({ showTranscript: event.target.checked })}/>Show transcript in preview</label>
  </div>;
}

function AppearanceControls({ config, onChange }: { config: LabConfig; onChange: (patch: Partial<LabConfig>) => void }) {
  return <div className="rmlab-control-stack">
    <div className="rmlab-color-row">{([{ key: 'accent', label: 'Accent' }, { key: 'background', label: 'Canvas' }, { key: 'foreground', label: 'Text' }] as const).map(({ key, label }) => <label key={key}><ColorControl label={`${label} color`} value={config[key]} onCommit={color => onChange({ [key]: color })}/><span>{label}</span></label>)}</div>
    <Field label="Format"><select value={config.aspect} onChange={event => onChange({ aspect: event.target.value as LabConfig['aspect'] })}><option value="landscape">Landscape · 16:9</option><option value="portrait">Portrait · 9:16</option></select></Field>
    <div className="rmlab-field-pair"><Field label="Duration (s)"><input type="number" min={2} max={60} step="0.5" value={config.duration} onChange={event => {
      const duration = Math.min(60, Math.max(2, Number(event.target.value))), ratio = duration / config.duration;
      onChange({ duration, items: config.items.map(item => ({ ...item, start: Number((item.start * ratio).toFixed(2)) })), words: config.words.map(word => ({ ...word, start: Math.min(duration, Number((word.start * ratio).toFixed(2))), end: Math.min(duration, Number((word.end * ratio).toFixed(2))) })) });
    }}/></Field><Field label="Frame rate"><select value={config.fps} onChange={event => onChange({ fps: Number(event.target.value) })}><option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></select></Field></div>
    <label className="rmlab-check"><input type="checkbox" checked={config.showGuides} onChange={event => onChange({ showGuides: event.target.checked })}/>Show safe-area guides</label>
  </div>;
}

function MotionControls({ config, onChange }: { config: LabConfig; onChange: (patch: Partial<LabConfig>) => void }) {
  return <div className="rmlab-control-stack">
    <Field label="Entrance"><select value={config.motion} onChange={event => onChange({ motion: event.target.value as LabConfig['motion'] })}><option value="spring">Remotion spring</option><option value="ease">Cubic ease out</option><option value="linear">Linear</option></select></Field>
    <RangeField label="Entrance duration" value={config.entrance} min={.15} max={3} step={.05} unit="s" onChange={entrance => onChange({ entrance })}/>
    <RangeField label="Travel distance" value={config.distance} min={0} max={200} unit="px" onChange={distance => onChange({ distance })}/>
    <RangeField label="Spring damping" value={config.damping} min={3} max={40} onChange={damping => onChange({ damping })}/>
    <RangeField label="Spring stiffness" value={config.stiffness} min={40} max={400} step={5} onChange={stiffness => onChange({ stiffness })}/>
    <RangeField label="Motion blur" value={config.blur} min={0} max={12} onChange={blur => onChange({ blur })}/>
    <p className="rmlab-help">Lower damping adds overshoot. Blur uses deterministic samples of earlier frames; pause or step through to inspect it.</p>
  </div>;
}

function Templates({ saved, onApply, onDelete, onSave, onImport, onExport }: { saved: LabTemplate[]; onApply: (template: LabTemplate) => void; onDelete: (id: string) => void; onSave: (name: string) => void; onImport: (file: File) => void; onExport: () => void }) {
  const [name, setName] = useState('My motion design');
  const fileRef = useRef<HTMLInputElement>(null);
  return <div className="rmlab-templates">
    <div className="rmlab-template-intro"><span className="rmlab-kicker">A starting point, made yours</span><h2>Find the feeling.</h2><p>Load a design to preview it. Every word, color, number and cue stays editable.</p></div>
    <div className="rmlab-template-grid">{LAB_TEMPLATES.map((template, index) => <button type="button" key={template.id} className="rmlab-template-card" onClick={() => onApply(template)}>
      <div className={`rmlab-template-thumbnail rmlab-template-thumbnail-${template.config.scene}`} style={{ '--template-accent': template.config.accent, backgroundColor: template.config.background } as CSSProperties}><span className="rmlab-template-no">0{index + 1}</span>{template.config.scene === 'typography' ? <strong>Make<br/>it move.</strong> : template.config.scene === 'counter' ? <strong>$128<small>k</small></strong> : template.config.scene === 'chart' ? <div className="rmlab-mini-bars"><i/><i/><i/></div> : <div className="rmlab-mini-cards"><i/><i/><i/></div>}<ArrowUpRight size={16}/></div>
      <strong>{template.name}</strong><span>{template.description}</span>
    </button>)}</div>
    <section className="rmlab-local-templates"><h3><Save size={15}/>Your templates</h3><p>Saved in this browser. Export JSON to move a design to another machine.</p><div className="rmlab-save-row"><input aria-label="Template name" value={name} maxLength={60} placeholder="Name this design" onChange={event => setName(event.target.value)}/><PrimaryButton type="button" size="compact" className="rmlab-save-primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}><Save size={14}/>Save current</PrimaryButton></div>
      {saved.length ? <div className="rmlab-saved-list">{saved.map(template => <div key={template.id}><button type="button" onClick={() => onApply(template)}><i style={{ background: template.config.accent }}/><span>{template.name}</span><ArrowUpRight size={13}/></button><button type="button" className="rmlab-icon-button" aria-label={`Delete saved template ${template.name}`} onClick={() => onDelete(template.id)}><X size={13}/></button></div>)}</div> : <div className="rmlab-empty-saved"><Layers3 size={18}/><span>Your first saved design will appear here.</span></div>}
      <div className="rmlab-button-row"><button type="button" className="rmlab-button" onClick={onExport}><Download size={14}/>Export current JSON</button><button type="button" className="rmlab-button" onClick={() => fileRef.current?.click()}><Upload size={14}/>Import template</button></div><input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ''; }}/>
    </section>
  </div>;
}

export function RemotionDevTests({ embedded = false, query = '' }: { embedded?: boolean; query?: string }) {
  const id = useId();
  const [category, setCategory] = useState<LabCategory>('explainer');
  const [config, setConfig] = useState<LabConfig>(() => cloneConfig(DEFAULT_LAB_CONFIG));
  const [frame, setFrame] = useState(60);
  const frameRef = useRef(frame);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [rate, setRate] = useState(1);
  const [notice, setNotice] = useState('');
  const [audio, setAudio] = useState<LocalAudio | null>(null);
  const mediaRef = useRef<HTMLAudioElement>(null);
  const [saved, setSaved] = useState<LabTemplate[]>([]);
  const [controlTab, setControlTab] = useState<'content' | 'speech' | 'style' | 'motion'>('content');
  const currentCategory = LAB_CATEGORIES.find(item => item.id === category)!;
  const search = query.trim().toLocaleLowerCase();
  const categories = LAB_CATEGORIES.filter(item => !search || `${item.label} ${item.description} ${item.id === 'explainer' ? 'cards diagrams arrows charts counters speech' : ''}`.toLocaleLowerCase().includes(search));
  const visibleCategory = categories.some(item => item.id === category) ? category : categories[0]?.id;
  const activeCategory = LAB_CATEGORIES.find(item => item.id === visibleCategory) ?? currentCategory;
  const visualConfig = visibleCategory === 'polish' ? { ...config, scene: 'polish' as const } : visibleCategory === 'typography' ? { ...config, scene: 'typography' as const } : config;
  const totalFrames = Math.round(config.duration * config.fps);

  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (!Array.isArray(value)) return;
      const loaded = value.slice(0, 30).flatMap((entry: unknown) => {
        try {
          if (!entry || typeof entry !== 'object' || !('id' in entry) || !('name' in entry) || !('config' in entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') return [];
          return [{ id: entry.id.slice(0, 100), name: entry.name.slice(0, 60), description: 'Saved in this browser', config: parseLabConfig(entry.config) }];
        } catch { return []; }
      });
      setSaved(loaded);
    } catch { /* A blocked or outdated browser store does not prevent previewing designs. */ }
  }, []);

  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url); }, [audio]);

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  useEffect(() => {
    if (!playing) { mediaRef.current?.pause(); return; }
    const media = audio ? mediaRef.current : null;
    let cancelled = false;
    let anchorTime = performance.now();
    let anchorFrame = frameRef.current;
    let raf = 0;
    if (media) {
      media.currentTime = anchorFrame / config.fps;
      media.playbackRate = rate;
      void media.play().catch(() => { if (!cancelled) { setPlaying(false); setNotice('The voiceover could not play. Try another audio file.'); } });
    }
    const tick = (time: number) => {
      let next = media ? Math.floor(media.currentTime * config.fps) : Math.floor(anchorFrame + (time - anchorTime) / 1000 * config.fps * rate);
      if (next >= totalFrames || media?.ended) {
        if (!loop) { setFrame(Math.min(totalFrames - 1, next)); setPlaying(false); return; }
        next = 0; anchorFrame = 0; anchorTime = time;
        if (media) { media.currentTime = 0; if (media.paused) void media.play().catch(() => setPlaying(false)); }
      }
      frameRef.current = next; setFrame(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); media?.pause(); };
  }, [playing, audio, config.fps, totalFrames, loop, rate]);

  function seek(next: number) {
    const bounded = Math.max(0, Math.min(totalFrames - 1, next));
    setPlaying(false); frameRef.current = bounded; setFrame(bounded);
    if (mediaRef.current && audio) mediaRef.current.currentTime = bounded / config.fps;
  }
  function change(patch: Partial<LabConfig>) { setConfig(current => ({ ...current, ...patch })); if (patch.duration || patch.fps) { setPlaying(false); const next = Math.min(frame, Math.round((patch.duration ?? config.duration) * (patch.fps ?? config.fps)) - 1); frameRef.current = next; setFrame(next); } }
  function selectCategory(next: LabCategory) {
    setCategory(next); setPlaying(false);
    if (next === 'typography') { change({ scene: 'typography' }); setControlTab('content'); }
    if (next === 'polish') { change({ scene: 'polish' }); setControlTab('motion'); seek(12); }
    if (next === 'explainer' && (config.scene === 'typography' || config.scene === 'polish')) { change({ scene: 'cards' }); setControlTab('content'); }
  }
  function applyTemplate(template: LabTemplate) { setConfig(cloneConfig(template.config)); setCategory(template.config.scene === 'typography' ? 'typography' : template.config.scene === 'polish' ? 'polish' : 'explainer'); setControlTab('content'); setPlaying(false); frameRef.current = 0; setFrame(0); setNotice(`Loaded “${template.name}”. Press play to preview it.`); }
  function persist(next: LabTemplate[]) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSaved(next); return true; } catch { setNotice('Browser storage is unavailable. Export JSON to keep this design.'); return false; } }
  function save(name: string) { const template = { id: crypto.randomUUID(), name, description: 'Saved in this browser', config: cloneConfig(visualConfig) }; if (persist([template, ...saved].slice(0, 30))) setNotice(`Saved “${name}” in this browser.`); }
  async function importTemplate(file: File) { try { if (file.size > 500_000) throw new Error('Choose a template smaller than 500 KB.'); const checked = parseLabFile(JSON.parse(await file.text())); applyTemplate({ id: 'import', name: file.name.replace(/\.json$/i, ''), description: 'Imported template', config: checked }); } catch (error) { setNotice(error instanceof Error ? error.message : 'The template could not be read.'); } }
  function addAudio(file: File) {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|ogg|aac|flac|webm)$/i.test(file.name)) { setNotice('Choose an audio file for the voiceover.'); return; }
    setPlaying(false); setAudio({ name: file.name, url: URL.createObjectURL(file) });
    setNotice('Local voiceover added. Edit the sample word times to match your audio; the preview uses the audio clock.');
  }
  const tabs = [{ id: 'content', label: 'Content' }, { id: 'speech', label: 'Speech cues' }, { id: 'style', label: 'Style' }, { id: 'motion', label: 'Motion' }] as const;

  return <section className={`rmlab ${embedded ? 'rmlab-embedded' : 'rmlab-workspace'}`} aria-label="Remotion development lab">
    {!embedded ? <header className="rmlab-app-header"><a href="/editor/demo" className="rmlab-back"><ArrowLeft size={15}/>Back to editor</a><a href="/editor/demo" className="rmlab-wordmark">revline<span>®</span></a><span className="rmlab-dev-badge"><FlaskConical size={12}/>DEVELOPMENT</span></header> : null}
    <div className="rmlab-shell">
      <header className="rmlab-heading"><div><span className="rmlab-kicker"><span className="rmlab-live-dot"/>REMOTION / DEV TESTS</span><h1>Ideas, in motion<span>.</span></h1>{!embedded ? <p>Six ways to make the story easier to see. Play, edit, and find your style.</p> : <p>Try six motion tools. Every preview is editable.</p>}</div>{embedded ? <a className="rmlab-expand" href="/remotion-dev-tests" target="_blank" rel="noopener noreferrer" title="Open full Remotion playground"><ExternalLink size={15}/><span>Full lab</span></a> : <span className="rmlab-heading-note">AN EXPLORATION SPACE<br/>FOR YOUR NEXT GREAT EDIT</span>}</header>
      <nav className="rmlab-categories" aria-label="Motion experiments">{categories.map((item, index) => <button type="button" key={item.id} aria-pressed={visibleCategory === item.id} onClick={() => selectCategory(item.id)}><span>{String(LAB_CATEGORIES.findIndex(value => value.id === item.id) + 1).padStart(2, '0')}</span>{item.label}{!embedded && index === 0 ? <i>START HERE</i> : null}</button>)}</nav>
      {!visibleCategory ? <p className="rmlab-no-results">No motion experiments match “{query}”. Try cards, tracking, typography or templates.</p> : <>
        <div className="rmlab-section-heading"><div><h2>{activeCategory.label}{visibleCategory === 'explainer' ? <span>RECOMMENDED</span> : null}</h2><p>{activeCategory.description}</p></div>{!embedded ? <span className="rmlab-section-count">EXPERIMENT {String(LAB_CATEGORIES.findIndex(value => value.id === visibleCategory) + 1).padStart(2, '0')} / 06</span> : null}</div>
        {visibleCategory === 'tracking' || visibleCategory === 'masking' ? <SubjectToolsLab mode={visibleCategory}/> : <div className="rmlab-editor-grid">
          <div className="rmlab-preview-column">
            <div className="rmlab-preview-toolbar"><span><i/>{visualConfig.scene === 'typography' ? REMOTION_TEXT_LABELS[config.textPreset] : visualConfig.scene === 'polish' ? 'Easing comparison' : LAB_SCENES.find(scene => scene.id === config.scene)?.label ?? 'Composition'}</span><span>{config.aspect === 'portrait' ? '540 × 960' : '960 × 540'} · {config.fps} fps</span></div>
            <div className={`rmlab-stage-wrap ${config.aspect === 'portrait' ? 'rmlab-stage-portrait' : ''}`}><Preview config={visualConfig} frame={frame}/></div>
            <div className="rmlab-player">
              <div className="rmlab-transport"><div className="rmlab-button-row"><button type="button" className="rmlab-icon-button" aria-label="Replay preview" onClick={() => { setPlaying(false); frameRef.current = 0; setFrame(0); if (mediaRef.current) mediaRef.current.currentTime = 0; requestAnimationFrame(() => setPlaying(true)); }}><RotateCcw size={15}/></button><PrimaryButton type="button" size="icon" className="rmlab-play-button" aria-label={playing ? 'Pause preview' : 'Play preview'} onClick={() => { if (!playing && frame >= totalFrames - 1) { frameRef.current = 0; setFrame(0); } setPlaying(current => !current); }}>{playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</PrimaryButton><button type="button" className="rmlab-frame-step" aria-label="Previous frame" onClick={() => seek(frame - 1)}>−1</button><button type="button" className="rmlab-frame-step" aria-label="Next frame" onClick={() => seek(frame + 1)}>+1</button><output className="rmlab-time">{(frame / config.fps).toFixed(2)}<span> / {config.duration.toFixed(2)}s</span></output></div><div className="rmlab-player-options"><select aria-label="Playback speed" value={rate} onChange={event => setRate(Number(event.target.value))}><option value={.1}>0.1×</option><option value={.25}>0.25×</option><option value={.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option></select><label title="Loop preview"><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)}/>Loop</label></div></div>
              <Timeline config={config} frame={frame} onSeek={seek}/>
              <div className="rmlab-preview-footnote"><span>{audio ? <><AudioLines size={12}/>Local voiceover</> : 'Sample timings · add your own audio in Speech cues'}</span><span>FRAME {frame}</span></div>
            </div>
            {visibleCategory === 'templates' ? <Templates saved={saved} onApply={applyTemplate} onSave={save} onDelete={templateId => { if (persist(saved.filter(template => template.id !== templateId))) setNotice('Saved template removed.'); }} onImport={file => void importTemplate(file)} onExport={() => downloadJson('revline-motion-template.json', labTemplateFile(visualConfig))}/> : !embedded ? <div className="rmlab-tip"><Sparkles size={17}/><div><strong>{visibleCategory === 'polish' ? 'Watch it at 0.1×.' : visibleCategory === 'typography' ? 'The rhythm is in the details.' : 'Say “three revenue streams”. Show three ideas.'}</strong><p>{visibleCategory === 'polish' ? 'Scrub the entrance and change damping to see how the spring settles. Turn on motion blur to inspect the frame samples.' : visibleCategory === 'typography' ? 'Choose a type treatment, then tune the words and their exact timing in Speech cues.' : 'The cards use editable speech timestamps. Click the numbered timeline cues to jump straight to each reveal.'}</p></div></div> : null}
          </div>
          <aside className="rmlab-inspector" aria-label="Composition controls">
            <div className="rmlab-inspector-heading"><span><Settings2 size={15}/>Make it yours</span><button type="button" className="rmlab-icon-button" aria-label="Reset composition" title="Reset composition" onClick={() => { setConfig(cloneConfig(DEFAULT_LAB_CONFIG)); seek(0); setNotice('Composition reset to the starting design.'); }}><RotateCcw size={13}/></button></div>
            <div className="rmlab-control-tabs" role="tablist" aria-label="Composition settings" onKeyDown={event => {
              const current = tabs.findIndex(tab => tab.id === controlTab);
              const next = event.key === 'ArrowRight' ? (current + 1) % tabs.length : event.key === 'ArrowLeft' ? (current + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
              if (next === undefined) return;
              event.preventDefault(); setControlTab(tabs[next].id); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
            }}>{tabs.map(tab => <button key={tab.id} type="button" role="tab" id={`${id}-${tab.id}`} tabIndex={controlTab === tab.id ? 0 : -1} aria-selected={controlTab === tab.id} aria-controls={`${id}-controls`} onClick={() => setControlTab(tab.id)}>{tab.label}</button>)}</div>
            <div className="rmlab-controls" id={`${id}-controls`} role="tabpanel" aria-labelledby={`${id}-${controlTab}`}>
              {controlTab === 'content' ? <div className="rmlab-control-stack">
                {visibleCategory !== 'typography' && visibleCategory !== 'polish' ? <Field label="Graphic type"><select value={config.scene === 'typography' || config.scene === 'polish' ? 'cards' : config.scene} onChange={event => change({ scene: event.target.value as LabConfig['scene'] })}>{LAB_SCENES.map(scene => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></Field> : null}
                {visibleCategory === 'typography' ? <><Field label="Type treatment"><select value={config.textPreset} onChange={event => change({ textPreset: event.target.value as LabConfig['textPreset'] })}>{REMOTION_TEXT_PRESETS.map(preset => <option key={preset} value={preset}>{REMOTION_TEXT_LABELS[preset]}</option>)}</select></Field><RangeField label="Type size" value={config.textSize} min={24} max={110} unit="px" onChange={textSize => change({ textSize })}/></> : null}
                <Field label={visibleCategory === 'typography' ? 'Title / animated text' : 'Headline'}><textarea rows={2} maxLength={200} value={config.title} onChange={event => change({ title: event.target.value })}/></Field>
                <Field label="Eyebrow"><input maxLength={150} value={config.subtitle} onChange={event => change({ subtitle: event.target.value })}/></Field>
                {visibleCategory === 'typography' && config.textPreset === 'karaoke' ? <p className="rmlab-help">Karaoke uses the words in Speech cues. Other treatments animate the title above.</p> : null}
                {visibleCategory !== 'typography' && visibleCategory !== 'polish' ? <><div className="rmlab-control-divider"><span>THREE TIMED ITEMS</span></div><ItemControls config={config} onChange={change} onSeek={seek}/>{config.scene === 'chart' || config.scene === 'counter' ? <div className="rmlab-field-pair"><Field label="Number prefix"><input maxLength={12} value={config.counterPrefix} onChange={event => change({ counterPrefix: event.target.value })}/></Field><Field label="Number suffix"><input maxLength={12} value={config.counterSuffix} onChange={event => change({ counterSuffix: event.target.value })}/></Field></div> : null}</> : null}
              </div> : controlTab === 'speech' ? <SpeechControls config={config} onChange={change} onSeek={seek} audio={audio} onAudio={addAudio} onRemoveAudio={() => { setPlaying(false); setAudio(null); }} onNotice={setNotice}/> : controlTab === 'style' ? <AppearanceControls config={config} onChange={change}/> : <MotionControls config={config} onChange={change}/>}
            </div>
            <div className="rmlab-inspector-footer"><button type="button" className="rmlab-button" onClick={() => { setConfig(visualConfig); setCategory('templates'); setNotice('Name your design below the preview to save it.'); }}><Save size={13}/>Save as template</button><button type="button" className="rmlab-icon-button" title="Export current template JSON" aria-label="Export current template JSON" onClick={() => downloadJson('revline-motion-template.json', labTemplateFile(visualConfig))}><Download size={14}/></button></div>
          </aside>
        </div>}
      </>}
      {notice ? <div className="rmlab-notice" role="status"><Check size={14}/><span>{notice}</span><button type="button" className="rmlab-icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={13}/></button></div> : null}
      {!embedded ? <footer className="rmlab-page-footer"><span><FlaskConical size={13}/>A development playground inside Revline.</span><span>Explore freely. Save the ideas you like.</span></footer> : null}
    </div>
    {audio ? <audio ref={mediaRef} src={audio.url} preload="metadata" onError={() => { setPlaying(false); setNotice('This audio format could not be loaded. Choose another voiceover.'); }}/> : null}
  </section>;
}
