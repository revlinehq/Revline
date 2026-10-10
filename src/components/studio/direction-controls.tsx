"use client";
import { useState } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Asset } from "@/lib/project";
import { cameraModes, revealModes, textLayer, type MotionLayerData, type SceneDesign } from "@/motion/schema";
import { easingNames } from "@/motion/core/easing";
import { transitionTypes } from "@/motion/core/timeline";

type Option = readonly [string,string];
function Choice({ label, value, options, onChange }: { label: string; value: string; options: readonly Option[]; onChange: (value: string) => void }) {
  return <label className="direction-field"><span>{label}</span><div className="native-select"><select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{options.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown className="size-3"/></div></label>;
}
function NumberControl({ label, value, min = 0, max = 100, step = 1, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return <label className="direction-field"><span>{label}</span><Input type="number" aria-label={label} value={Number(value.toFixed(3))} min={min} max={max} step={step} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= min && n <= max) onChange(n); }}/></label>;
}
const titleCase = (name: string) => name.split('-').map(s => s[0].toUpperCase()+s.slice(1)).join(' ');
const options = (names: readonly string[]): Option[] => names.map(name => [name,titleCase(name)]);
function LayerEditor({ layer, assets, onChange, onRemove }: { layer: MotionLayerData; assets: Asset[]; onChange: (layer: MotionLayerData) => void; onRemove: () => void }) {
  const [selectedKey, setSelectedKey] = useState(0);
  const keyIndex = Math.min(selectedKey,layer.keyframes.length - 1); const key = layer.keyframes[keyIndex];
  const changeKey = (patch: Partial<typeof key>) => onChange({ ...layer, keyframes: layer.keyframes.map((k,i) => i === keyIndex ? { ...k,...patch } : k) });
  const next = layer.keyframes[keyIndex + 1];
  return <details className="layer-editor"><summary>{layer.type === "text" ? layer.text.slice(0,24) || "Text layer" : titleCase(layer.type)+" layer"}<span>{layer.keyframes.length} keys</span></summary><div className="direction-fields">
    <Choice label="Layer type" value={layer.type} options={options(["text","rect","ellipse","image"])} onChange={v => onChange({ ...layer,type: v as MotionLayerData["type"],assetId: v === "image" ? layer.assetId || assets[0]?.id || null : layer.assetId })}/>
    {layer.type === "text" ? <label className="direction-field"><span>Layer text</span><Textarea aria-label="Layer text" maxLength={140} value={layer.text} onChange={e => onChange({ ...layer,text: e.target.value })}/></label> : layer.type === "image" ? <Choice label="Layer image" value={layer.assetId || ""} options={[["","Choose image"],...assets.map(a => [a.id,a.name] as const)]} onChange={v => onChange({ ...layer,assetId: v || null })}/> : null}
    <div className="field-grid"><NumberControl label="Layer width %" value={layer.width * 100} min={2} onChange={v => onChange({ ...layer,width: v / 100 })}/><NumberControl label="Layer height %" value={layer.height * 100} min={2} onChange={v => onChange({ ...layer,height: v / 100 })}/></div>
    {layer.type === "text" ? <NumberControl label="Type size %" value={layer.fontSize * 100} min={1} max={20} step={.1} onChange={v => onChange({ ...layer,fontSize: v / 100 })}/> : null}
    <Choice label="Layer color" value={layer.color} options={[...options(["ink","muted","accent","surface"]),...(layer.color.startsWith('#') ? [[layer.color,layer.color] as const] : [])]} onChange={v => onChange({ ...layer,color: v })}/>
    <Choice label="Selected keyframe" value={String(keyIndex)} options={layer.keyframes.map((k,i) => [String(i),`${i+1} / ${Math.round(k.at * 100)}% of shot`])} onChange={v => setSelectedKey(Number(v))}/>
    <NumberControl label="Keyframe time %" value={key.at * 100} min={keyIndex ? (layer.keyframes[keyIndex - 1].at + .001) * 100 : 0} max={next ? (next.at - .001) * 100 : 100} step={.1} onChange={v => changeKey({ at: v / 100 })}/>
    <div className="field-grid"><NumberControl label="Keyframe X %" value={key.x * 100} min={-100} max={200} onChange={v => changeKey({ x: v / 100 })}/><NumberControl label="Keyframe Y %" value={key.y * 100} min={-100} max={200} onChange={v => changeKey({ y: v / 100 })}/></div>
    <div className="field-grid"><NumberControl label="Keyframe scale" value={key.scale} min={.01} max={5} step={.05} onChange={v => changeKey({ scale: v })}/><NumberControl label="Keyframe rotation" value={key.rotation} min={-360} max={360} onChange={v => changeKey({ rotation: v })}/></div>
    <div className="field-grid"><NumberControl label="Keyframe opacity %" value={key.opacity * 100} onChange={v => changeKey({ opacity: v / 100 })}/><NumberControl label="Keyframe blur" value={key.blur} max={24} onChange={v => changeKey({ blur: v })}/></div>
    <Choice label="Keyframe easing" value={key.easing} options={options(easingNames)} onChange={v => changeKey({ easing: v as typeof key.easing })}/>
    <div className="layer-actions"><Button variant="outline" size="sm" disabled={!next || layer.keyframes.length >= 8} onClick={() => { if (!next) return; const keys = [...layer.keyframes]; keys.splice(keyIndex + 1,0,{ ...key,at: (key.at + next.at) / 2 }); onChange({ ...layer,keyframes: keys }); setSelectedKey(keyIndex + 1); }}><Plus/>Keyframe</Button><Button variant="ghost" size="sm" disabled={layer.keyframes.length <= 2} onClick={() => { onChange({ ...layer,keyframes: layer.keyframes.filter((_,i) => i !== keyIndex) }); setSelectedKey(Math.max(0,keyIndex - 1)); }}>Remove key</Button></div>
    <Button variant="ghost" size="sm" onClick={onRemove}><Trash2/>Remove layer</Button>
  </div></details>;
}
export function DirectionControls({ design, assets, composer, layoutOptions = [], onChange }: { design: SceneDesign; assets: Asset[]; composer: boolean; layoutOptions?: SceneDesign["layout"][]; onChange: (patch: Partial<SceneDesign>) => void }) {
  const add = (type: MotionLayerData["type"]) => { if (design.layers.length >= 6) return; const layer = textLayer(); onChange({ layers: [...design.layers,{ ...layer,type,assetId: type === "image" ? assets[0]?.id || null : null,width: type === "text" ? .7 : .2,height: type === "text" ? .12 : .2 }] }); };
  return <div className="direction-controls">
    <details><summary>Shot direction<span>Camera · type · cuts</span></summary><div className="direction-fields">
      {layoutOptions.length > 0 ? <Choice label="Composition layout" value={design.layout} options={options(layoutOptions)} onChange={v => onChange({ layout: v as SceneDesign["layout"] })}/> : null}
      <Choice label="Text reveal" value={design.reveal} options={options(revealModes)} onChange={v => onChange({ reveal: v as SceneDesign["reveal"] })}/>
      <Choice label="Easing curve" value={design.easing} options={options(easingNames)} onChange={v => onChange({ easing: v as SceneDesign["easing"] })}/>
      <NumberControl label="Stagger seconds" value={design.stagger} max={.3} step={.01} onChange={v => onChange({ stagger: v })}/>
      <Choice label="Camera movement" value={design.camera.mode} options={composer ? [["focus","Send close-up"],["static","Static"]] : options(cameraModes)} onChange={v => onChange({ camera: { ...design.camera,mode: v as SceneDesign["camera"]["mode"] } })}/>
      <NumberControl label="Camera strength %" value={design.camera.strength * 100} onChange={v => onChange({ camera: { ...design.camera,strength: v / 100 } })}/>
      {!composer ? <div className="field-grid"><NumberControl label="Focus X %" value={design.camera.focusX * 100} onChange={v => onChange({ camera: { ...design.camera,focusX: v / 100 } })}/><NumberControl label="Focus Y %" value={design.camera.focusY * 100} onChange={v => onChange({ camera: { ...design.camera,focusY: v / 100 } })}/></div> : null}
      <Choice label="Incoming transition" value={design.transition.type} options={options(transitionTypes)} onChange={v => onChange({ transition: { ...design.transition,type: v as SceneDesign["transition"]["type"] } })}/>
      <NumberControl label="Transition seconds" value={design.transition.duration} max={1.2} step={.1} onChange={v => onChange({ transition: { ...design.transition,duration: v } })}/>
      <label className="direction-toggle"><input type="checkbox" checked={design.motionBlur} onChange={e => onChange({ motionBlur: e.target.checked })}/>Soften moving layers</label>
    </div></details>
    <details><summary>Background<span>Pattern or image</span></summary><div className="direction-fields"><Choice label="Background pattern" value={design.background} options={options(["plain","grid","orbit"])} onChange={v => onChange({ background: v as SceneDesign["background"] })}/><Choice label="Background image" value={design.backgroundAssetId || "none"} options={[["none","No image"],...assets.map(a => [a.id,a.name] as const)]} onChange={v => onChange({ backgroundAssetId: v === "none" ? null : v })}/></div></details>
    <details><summary>Layers<span>{design.layers.length} / 6</span></summary><div className="direction-fields"><p className="small-note">Independent keyframes, measured as a percentage of this shot.</p><div className="layer-actions"><Button size="sm" variant="outline" disabled={design.layers.length >= 6} onClick={() => add("text")}><Plus/>Text</Button><Button size="sm" variant="outline" disabled={design.layers.length >= 6} onClick={() => add("rect")}>Shape</Button><Button size="sm" variant="outline" disabled={design.layers.length >= 6 || !assets.length} onClick={() => add("image")}>Image</Button></div>{design.layers.map(layer => <LayerEditor key={layer.id} layer={layer} assets={assets} onChange={next => onChange({ layers: design.layers.map(l => l.id === layer.id ? next : l) })} onRemove={() => onChange({ layers: design.layers.filter(l => l.id !== layer.id) })}/>)}</div></details>
  </div>;
}
