import { dimensions, trackOf, type Clip, type SceneBlueprint, type SceneMedia, type Timeline, type TimelineMarker, type SceneBeats } from './types';
import { TEXT_FONTS } from './text-fonts';
import { validateSceneBrand, type SceneBrand } from './brand-kit';
import { SCENE_RUNTIME_BUNDLES } from './scene-modules';
import { markerBeats, shownClips } from './beat-timing';

export const SCENE_BLUEPRINT_LIMIT = 4;
// Stored timelines keep code in sceneCode rows (lib/editor/scene-code), so it no longer weighs on every edit.
// Scene code has no length limit; only titles are capped.
export const SCENE_LIMITS = { title: 80 } as const;
/** The contract writing-scenes states; the motion and recreate lanes check it at finish. Shared code counts once. */
export const SCENE_CONTRACT_LIMITS = { sceneCode: 120_000, timelineCode: 400_000, sceneSeconds: 120, filmSeconds: 180 } as const;

export function validateScene(clip: Pick<Clip, 'kind' | 'scene' | 'assetId'>) {
  if (clip.kind !== 'scene') { if (clip.scene) throw new Error('Only scene clips can hold scene code.'); return; }
  const scene = clip.scene;
  if (!scene || typeof scene.title !== 'string' || typeof scene.code !== 'string') throw new Error('A scene needs a title and code.');
  if (clip.assetId) throw new Error('Scenes cannot reference media.');
  if (!scene.title.trim() || scene.title.length > SCENE_LIMITS.title) throw new Error(`Scene titles need 1–${SCENE_LIMITS.title} characters.`);
  if (!scene.code.trim()) throw new Error('A scene needs code.');
  if (scene.brand) validateSceneBrand(scene.brand);
  if (scene.film && !(Number.isFinite(scene.film.duration) && scene.film.duration > 0 && scene.film.duration <= 600)) throw new Error('A film runs 0 to 600 seconds.');
  if (scene.blueprints && (scene.blueprints.length > SCENE_BLUEPRINT_LIMIT || scene.blueprints.some(item => !item.name?.trim() || item.name.length > 60 || typeof item.code !== 'string' || !item.code.trim()))) throw new Error(`A scene can mount up to ${SCENE_BLUEPRINT_LIMIT} blueprints.`);
  if (scene.media && (scene.media.some(item => !/^[a-zA-Z][\w-]{0,30}$/.test(item.name) || !item.assetId) || new Set(scene.media.map(item => item.name)).size !== scene.media.length)) throw new Error('Scene media needs files with unique names (letters, digits, - or _).');
}

/** `duration` is the clip's own; `filmDuration`, for a beat clip of a film, is what the scene module receives as its duration. */
export type SceneLayerSource = { clipId: string; title: string; code: string; brand?: SceneBrand; media?: SceneMedia[]; blueprints?: SceneBlueprint[]; start: number; duration: number; filmDuration?: number; beats?: SceneBeats; offset: number; zIndex: number; fps: number; width: number; height: number; scale: number };
export type SceneFont = { family: string; weight: string; url: string };

/** Code that reads music markers: beat(), downbeat(), accent(), beats() or a shot's `on` check. Others never reload on marker edits. */
const READS_BEATS = /(?<![\w$.])(?:beats?|downbeat|accent)\s*\(|\bon\s*:\s*['"`](?:beat|downbeat|accent)['"`]/;
/** The markers a scene reads: a film through its clips of the same code, a plain scene through its own clip. */
function sceneBeats(markers: TimelineMarker[], clip: Clip, films: Clip[]): SceneBeats | undefined {
  const scene = clip.scene;
  // Comments do not count: a resolved `2.866 /* downbeat(2) */` reads nothing.
  if (!scene || !READS_BEATS.test(scene.code.replace(/\/\*[^]*?\*\//g, ''))) return undefined;
  return markerBeats(markers, shownClips(films, clip), scene.film?.duration ?? clip.sourceStart + clip.duration * (clip.playbackRate ?? 1));
}

/** Scenes are authored on the 1080-based canvas and scaled to the output resolution. */
export function sceneLayerSources(timeline: Timeline, resolution = 1080): SceneLayerSource[] {
  const { width, height } = dimensions(timeline.aspectRatio, 1080);
  const markers = timeline.markers ?? [], films = markers.length ? timeline.clips.filter(clip => clip.kind === 'scene' && clip.scene?.film) : [];
  return timeline.clips.flatMap((clip, index) => clip.kind === 'scene' && clip.scene ? [{
    clipId: clip.id, title: clip.scene.title, code: clip.scene.code, ...(clip.scene.brand ? { brand: clip.scene.brand } : {}), ...(clip.scene.media?.length ? { media: clip.scene.media } : {}), ...(clip.scene.blueprints?.length ? { blueprints: clip.scene.blueprints } : {}), start: clip.start, duration: clip.duration, ...(clip.scene.film ? { filmDuration: clip.scene.film.duration } : {}), ...((beats => beats ? { beats } : {})(markers.length ? sceneBeats(markers, clip, films) : undefined)), offset: clip.sourceStart,
    zIndex: trackOf(clip) * 256 + index, fps: timeline.fps, width, height, scale: resolution / 1080,
  }] : []);
}

export function sceneFonts(urls: Partial<Record<string, string>>): SceneFont[] {
  return TEXT_FONTS.map(font => ({ family: font.family, weight: font.faceWeight, url: urls[font.id] ?? `/fonts/${font.fileName}` }));
}

/**
 * Installs the composition-side controller. Each scene runs in a frame with an
 * opaque origin, so it cannot reach the editor, the account or the network.
 * The composition posts clip-local times; exports wait for the frame's
 * "painted" acknowledgement before HyperFrames captures each frame.
 */
/** Asset ids every scene clip shows as media, so exports and shares carry those files. */
export function sceneMediaAssetIds(timeline: Timeline) {
  return [...new Set(timeline.clips.flatMap(clip => clip.kind === 'scene' ? clip.scene?.media?.map(item => item.assetId) ?? [] : []))];
}

/** fileUrls maps remote file URLs (brand fonts) to the copies an export wrote beside the composition. */
/** `preview` lets scene videos play natively while the editor plays; exports always seek them frame-exact. */
export function sceneRuntimeScript(sources: SceneLayerSource[], fonts: SceneFont[], runtimeUrl: string, mediaUrls: Record<string, string> = {}, fileUrls: Record<string, string> = {}, preview = false) {
  return `(function(initial,fonts,runtimeUrl,mediaUrls,fileUrls,bundles,preview){
var host=window,clock=host.__timelines.revline.__hfReal||host.__timelines.revline,composition=document.getElementById('composition'),entries=new Map(),fontData=new Map(),unregister;
var virtual=host.__HF_VIRTUAL_TIME__,later=virtual&&virtual.originalSetTimeout?virtual.originalSetTimeout:setTimeout.bind(window),nextFrame=virtual&&virtual.originalRequestAnimationFrame?virtual.originalRequestAnimationFrame:requestAnimationFrame.bind(window);
var runtimeSources=new Map(),iconSource=null,overscan=16;
function vendorScript(url,what){return fetch(url).then(function(response){if(!response.ok)throw new Error('The '+what+' could not load.');return response.text();}).then(function(text){return text.replace(/<\\/script/gi,'<\\\\/script');});}
function runtimeScript(){if(!runtimeSources.has('gsap'))runtimeSources.set('gsap',vendorScript(new URL(runtimeUrl,document.baseURI).href,bundles.gsap.label));return runtimeSources.get('gsap');}
var anchor=document.createElement('span');anchor.dataset.sceneFrameSource='';anchor.style.cssText='position:absolute;width:0;height:0;pointer-events:none';composition.appendChild(anchor);
function report(entry,message,stack){var error=new Error('Scene "'+entry.source.title+'": '+message);if(stack)error.stack=stack;entry.error=error;window.dispatchEvent(new ErrorEvent('error',{error:error,message:error.message}));}
function inner(){var layers=composition.querySelectorAll('.adjustment-layer');for(var i=0;i<layers.length;i++)if(!layers[i].querySelector('.adjustment-layer'))return layers[i];return composition;}
function find(id){var nodes=composition.querySelectorAll('[data-scene-clip]');for(var i=0;i<nodes.length;i++)if(nodes[i].dataset.sceneClip===id)return nodes[i];return null;}
function font(item){if(!fontData.has(item.url))fontData.set(item.url,fetch(new URL(fileUrls[item.url]||item.url,document.baseURI).href).then(function(response){if(!response.ok)throw new Error('font');return response.arrayBuffer();}).then(function(data){return {family:item.family,weight:item.weight,data:data};},function(){return null;}));return fontData.get(item.url);}
var mediaData=new Map();
function file(url){if(!mediaData.has(url))mediaData.set(url,fetch(new URL(url,document.baseURI).href).then(function(response){if(!response.ok)throw new Error('media');return response.blob();}).then(function(blob){return blob.arrayBuffer().then(function(data){return {type:blob.type,data:data};});},function(){return null;}));return mediaData.get(url);}
function wantedMedia(source){var screens=(source.brand&&source.brand.screens||[]).map(function(item){return {name:item.name,url:fileUrls[item.url]||item.url};});var media=(source.media||[]).map(function(item){return {name:item.name,url:mediaUrls[item.assetId]};});return Promise.all(screens.concat(media).map(function(item){return item.url?file(item.url).then(function(found){return found&&{name:item.name,type:found.type,data:found.data};}):Promise.resolve(null);})).then(function(list){return list.filter(Boolean);});}
function wantedIcons(source){/* Every quoted kebab-case name that is a Lucide icon, so wrappers like ic('x') or icon(name) work too; blueprints count. */var names=[],pattern=/['"\`]([a-z0-9]+(?:-[a-z0-9]+)*)['"\`]/g,match,code=allCode(source);while((match=pattern.exec(code)))if(names.indexOf(match[1])<0)names.push(match[1]);if(!names.length)return Promise.resolve({});if(!iconSource)iconSource=fetch(new URL('lucide-icons.json',new URL(runtimeUrl,document.baseURI)).href).then(function(response){if(!response.ok)throw new Error('icons');return response.json();}).catch(function(){iconSource=null;return {};});return iconSource.then(function(all){var picked={};names.forEach(function(name){if(all[name]!==undefined)picked[name]=all[name];});return picked;});}
function wantedFonts(source){var code=allCode(source),list=fonts.filter(function(item){return item.family==='Space Grotesk'||code.indexOf(item.family)>=0;}).concat(source.brand?source.brand.fonts:[]);return Promise.all(list.map(font)).then(function(list){return list.filter(Boolean);});}
// A scene's code with its blueprints and, for a transition, the beat clips it draws.
function allCode(source){var parts=[source.code];(source.blueprints||[]).forEach(function(item){parts.push(item.code);});return parts.join('\\n');}
function frameDocument(source,scripts){return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \\'none\\'; script-src \\'unsafe-inline\\' \\'unsafe-eval\\'; style-src \\'unsafe-inline\\'; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src data: blob:"><style>html,body{margin:0;width:'+(source.width+overscan*2)+'px;height:'+(source.height+overscan*2)+'px;overflow:hidden;background:transparent}body{font-family:\\'Space Grotesk\\',Arial,sans-serif;color:#F4F4F0;-webkit-font-smoothing:antialiased}#scene-root{position:absolute;left:'+overscan+'px;top:'+overscan+'px;width:'+source.width+'px;height:'+source.height+'px;overflow:hidden}</style></head><body><div id="scene-root"></div>'+scripts.map(function(script){return '<script>'+script+'</'+'script>';}).join('')+'</body></html>';}
function send(entry,message){if(entry.frame.contentWindow)entry.frame.contentWindow.postMessage(Object.assign({source:'revline-scene-host'},message),'*');}
function mount(source){
  var key=JSON.stringify([source.code,source.brand||null,source.media||null,source.blueprints||null,source.width,source.height,source.fps,source.filmDuration||source.duration,source.beats||null]),entry=entries.get(source.clipId);
  var node=entry?entry.node:find(source.clipId);
  if(!node){node=document.createElement('div');node.className='scene-layer';node.dataset.sceneClip=source.clipId;inner().appendChild(node);}
  node.style.zIndex=String(source.zIndex);
  // HyperFrames sets visibility from these on every playback frame.
  node.dataset.start=String(source.start);node.dataset.duration=String(source.duration);node.dataset.end=String(source.start+source.duration);delete node.dataset.hfAutostamped;
  if(!entry||entry.key!==key){
    if(entry)entry.frame.remove();
    var frame=document.createElement('iframe');frame.className='scene-frame';frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('tabindex','-1');frame.setAttribute('aria-hidden','true');
    entry={node:node,frame:frame,key:key,source:source,seq:0,waiters:new Map(),compiled:false,error:null};
    var current=entry;current.ready=new Promise(function(resolve){current.resolve=resolve;});
    node.appendChild(frame);Promise.all([runtimeScript()]).then(function(scripts){if(entries.get(source.clipId)===current)frame.srcdoc=frameDocument(source,scripts);},function(error){report(current,error.message);current.resolve();});
  }
  entry.source=source;entry.frame.style.width=(source.width+overscan*2)+'px';entry.frame.style.height=(source.height+overscan*2)+'px';entry.frame.style.left=entry.frame.style.top=(-overscan*source.scale)+'px';entry.frame.style.transform='scale('+source.scale+')';
  entries.set(source.clipId,entry);
}
// Snapped to the scene's frames: the playback clock moves continuously and repaints are asked for far more
// often than frames change, so unsnapped times flooded the scene with seeks and left it no time to draw.
function localTime(entry,time){var fps=entry.source.fps||30;return Math.max(0,Math.round((time-entry.source.start+entry.source.offset)*fps)/fps);}
function visibleAt(entry,time){var local=time-entry.source.start;return local>=0&&local<entry.source.duration;}
// Only the editor preview plays live; paused, scrubbing or exporting gets frame-exact seeks. The preview
// player drives a paused clock by seeking it, so its runtime bridge says whether it is playing.
function playing(){if(!preview)return false;var player=host.__player;return player&&typeof player.isPlaying==='function'?!!player.isPlaying():!clock.paused();}
function seek(entry,time,live){entry.seq++;entry.posted=time;entry.live=!!live;entry.inflight=entry.seq;entry.sentAt=Date.now();entry.queued=undefined;send(entry,{type:'seek',time:time,seq:entry.seq,playing:!!live});return entry.seq;}
// Playback asks for a frame every animation frame. A scene slower than that would queue stale seeks and
// keep replaying them after a pause, so while one is drawing only the newest time waits for the next.
function follow(entry,time,live){if(entry.inflight&&Date.now()-entry.sentAt<1000){entry.queued=time;entry.queuedLive=live;}else seek(entry,time,live);}
function paint(time){
  bindExport();
  var live=playing();
  entries.forEach(function(entry){try{var visible=visibleAt(entry,time),state=visible?'visible':'hidden';if(entry.node.style.visibility!==state)entry.node.style.visibility=state;if(visible&&entry.compiled&&!entry.error&&(entry.posted!==localTime(entry,time)||entry.live!==live))follow(entry,localTime(entry,time),live);
    // A scene left behind while playing pauses its videos on the frame it last showed.
    else if(!visible&&entry.live&&entry.compiled&&!entry.error)follow(entry,entry.posted,false);}catch(error){report(entry,error&&error.message||String(error));}});
}
// Some clock moves (player swaps, end-of-playback resets) bypass render and onUpdate.
function watch(){if(entries.size)paint(clock.time());nextFrame(watch);}
function whenReady(time){
  var pending=[];
  entries.forEach(function(entry){
    if(!visibleAt(entry,time))return;
    pending.push(entry.ready.then(function(){
      if(entry.error)throw entry.error;
      // HyperFrames calls this on every runtime tick; a frame the scene already drew needs no new seek.
      var at=localTime(entry,time),live=playing();if(entry.drawn===at&&entry.drawnLive===live&&!entry.inflight)return;
      return new Promise(function(resolve,reject){var seq=entry.inflight&&entry.posted===at&&entry.live===live?entry.inflight:seek(entry,at,live),before=entry.waiters.get(seq);entry.waiters.set(seq,before?function(){before();resolve();}:resolve);later(function(){if(entry.waiters.delete(seq))reject(new Error('Scene "'+entry.source.title+'" did not finish drawing.'));},15000);});
    }));
  });
  return Promise.all(pending).then(function(){entries.forEach(function(entry){if(visibleAt(entry,time)&&entry.error)throw entry.error;});});
}
function bindExport(){if(!entries.size){if(unregister){unregister();unregister=undefined;}return;}if(!unregister&&host.__hyperframes)unregister=host.__hyperframes.registerFrameSource({element:anchor,render:whenReady});}
window.addEventListener('message',function(event){
  var data=event.data;if(!data||data.source!=='revline-scene')return;
  entries.forEach(function(entry){
    if(event.source!==entry.frame.contentWindow)return;
    if(data.type==='ready')Promise.all([wantedFonts(entry.source),wantedMedia(entry.source),wantedIcons(entry.source)]).then(function(found){send(entry,{type:'init',code:entry.source.code,brand:entry.source.brand||null,blueprints:entry.source.blueprints||[],beats:entry.source.beats||null,media:found[1],icons:found[2],width:entry.source.width,height:entry.source.height,fps:entry.source.fps,duration:entry.source.filmDuration||entry.source.duration,fonts:found[0]});});
    else if(data.type==='compiled'){entry.compiled=true;entry.resolve();paint(clock.time());}
    else if(data.type==='painted'){var done=entry.waiters.get(data.seq);if(done){entry.waiters.delete(data.seq);done();}if(data.seq===entry.seq){entry.drawn=entry.posted;entry.drawnLive=entry.live;}if(data.seq===entry.inflight){entry.inflight=0;if(entry.queued!==undefined&&(entry.queued!==entry.posted||entry.queuedLive!==entry.live))seek(entry,entry.queued,entry.queuedLive);entry.queued=undefined;}}
    else if(data.type==='error'){report(entry,String(data.message),data.stack);entry.resolve();entry.waiters.forEach(function(done){done();});entry.waiters.clear();}
  });
});
function setSources(sources){
  var wanted=new Set(sources.map(function(source){return source.clipId;}));
  entries.forEach(function(entry,id){if(!wanted.has(id)){entry.node.remove();entries.delete(id);}});
  composition.querySelectorAll('[data-scene-clip]').forEach(function(node){if(!wanted.has(node.dataset.sceneClip))node.remove();});
  sources.forEach(mount);paint(clock.time());
}
var previousRender=clock.render,previousUpdate=clock.eventCallback('onUpdate');
clock.render=function(){var result=previousRender.apply(clock,arguments);paint(clock.time());return result;};
clock.eventCallback('onUpdate',function(){if(previousUpdate)previousUpdate.call(clock);paint(clock.time());});
window.addEventListener('hf-seek',function(event){var detail=event.detail;if(detail&&typeof detail.waitUntil==='function')detail.waitUntil(whenReady(detail.time));});
host.__revlineSceneController={setSources:setSources,whenReady:whenReady,hasMedia:function(id){return !!mediaUrls[id];}};
setSources(initial);nextFrame(watch);
})(${JSON.stringify(sources).replace(/</g, '\\u003c')},${JSON.stringify(fonts).replace(/</g, '\\u003c')},${JSON.stringify(runtimeUrl).replace(/</g, '\\u003c')},${JSON.stringify(mediaUrls).replace(/</g, '\\u003c')},${JSON.stringify(fileUrls).replace(/</g, '\\u003c')},${JSON.stringify(SCENE_RUNTIME_BUNDLES)},${preview ? 'true' : 'false'});`;
}

export const SCENE_FONT_FAMILIES = TEXT_FONTS.map(font => font.family);

/** A complete starter scene: a title card that builds, holds and settles. */
export const STARTER_SCENE_CODE = `import { SplitText } from 'gsap/SplitText';

export default function scene({ root, tl, duration }) {
  root.innerHTML = \`
    <div class="stage" style="position:absolute;inset:0;background:#141413">
      <div style="position:absolute;left:10%;right:10%;top:38%">
        <h1 class="title" style="margin:0;font-size:112px;font-weight:700;line-height:1.05;letter-spacing:-2px">Your idea,<br>explained.</h1>
        <div class="rule" style="margin-top:36px;height:8px;width:60%;border-radius:4px;background:#D97757;transform-origin:left"></div>
        <div class="badge" style="margin-top:40px;display:inline-block;padding:14px 26px;border-radius:999px;background:#F4F4F0;color:#141413;font-size:40px;font-weight:700">Scene 1</div>
      </div>
    </div>\`;
  const title = new SplitText(root.querySelector('.title'), { type: 'words' });

  tl.to(root.querySelector('.stage'), { scale: 1.05, duration, ease: 'none' }, 0)
    .from(title.words, { yPercent: 60, opacity: 0, duration: 0.7, ease: 'expo.out', stagger: 0.08 }, 0.2)
    .from(root.querySelector('.rule'), { scaleX: 0, duration: 0.8, ease: 'power3.inOut' }, 0.6)
    .from(root.querySelector('.badge'), { scale: 0, opacity: 0, duration: 0.45, ease: 'back.out(1.7)' }, 1.2);
}
`;
