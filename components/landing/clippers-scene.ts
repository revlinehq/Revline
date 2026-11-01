import { CustomEase } from 'gsap/CustomEase';
import type { gsap } from 'gsap';
import { createEditor } from './clippers-editor';
import { icon, part as editorPart } from './clippers-dom';

type Aperture = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};
/** Original scene choreography, ported from revision 232 without the scene-engine runtime. */
export function createClippersScene(root: HTMLElement, tl: gsap.core.Timeline) {
  const media = {
    poster: '/landing/clippers-poster.webp',
    kai: '/landing/clippers-kai.webp',
    duke: '/landing/clippers-duke.webp',
    caseoh: '/landing/clippers-caseoh.webp',
    xqc: '/landing/clippers-xqc.webp',
    jynxzi: '/landing/clippers-jynxzi.webp',
  };
  const stage = document.createElement('div');
  stage.style.cssText =
    'position:absolute;inset:0;background:#111;color:#f4f4f0;font-family:var(--font-inter);overflow:hidden';
  root.appendChild(stage);
  const make = (parent: HTMLElement, cls: string, css: string, html = '') => {
    const e = document.createElement('div');
    e.className = cls;
    e.style.cssText = 'position:absolute;box-sizing:border-box;' + css;
    e.innerHTML = html;
    parent.appendChild(e);
    return e;
  };

  const window = make(
    stage,
    'window',
    'left:0;top:0;width:1920px;height:1080px;overflow:hidden;background:#111',
  );
  const ui = createEditor(window);
  const part = (name: string) => editorPart(ui, name);
  const all = (name: string) =>
    Array.from(ui.querySelectorAll<HTMLElement>('[data-part="' + name + '"]'));
  const find = (node: HTMLElement, selector: string) => {
    const found = node.querySelector<HTMLElement>(selector);
    if (!found) throw new Error('Missing clippers scene part: ' + selector);
    return found;
  };
  part('project-title').innerHTML =
    'Stream highlights ' + icon('chevron-down', { size: 14, color: '#888' });
  const side = part('sidebar');

  side
    .querySelectorAll(
      '[data-part="message-user"],[data-part="message-ai"],[data-part="step"]',
    )
    .forEach((e) => e.remove());
  const prompt = make(
    side,
    'prompt',
    'right:16px;top:28px;width:293px;min-height:66px;padding:11px 13px;border-radius:12px;background:#1f1f1f;font:400 13.6px/22px var(--font-inter);color:#ececec',
  );
  const promptText = make(
    prompt,
    'prompt-text',
    'position:relative;inset:auto;',
  );
  const text = 'clip this footage into 10 different engaging scenes';
  promptText.innerHTML = Array.from(text)
    .map((ch) => '<span class="letter">' + ch + '</span>')
    .join('');
  const reply = make(
    side,
    'reply',
    'left:16px;top:130px;width:365px;color:#e3e3e3;font:400 13.6px/22px var(--font-inter)',
    'Finding engaging scenes...',
  );
  const ready = make(
    side,
    'ready',
    'left:16px;top:130px;width:365px;color:#e3e3e3;font:400 13.6px/22px var(--font-inter)',
    '10 clips. Reframed to 9:16.',
  );
  const complete = make(
    side,
    'complete',
    'left:16px;top:172px;height:20px;display:flex;align-items:center;gap:8px;font:500 13.6px var(--font-inter);color:#e6e6e6',
    icon('circle-check', { size: 17, color: '#2e8f68' }) +
      'Ran 10 steps ' +
      icon('chevron-right', { size: 14, color: '#999' }),
  );
  tl.from(complete, { autoAlpha: 0, duration: 0.2 }, 3.15);

  const vf = part('video-frame');
  vf.style.cssText =
    'position:absolute;left:247px;top:60px;width:1024px;height:576px;overflow:hidden;background:transparent';
  vf.innerHTML = '';
  const portraitEase = CustomEase.create('portrait', '.65,0,.35,1');
  const aperture = { x: 1160, y: 404, width: 1024, height: 576, radius: 0 };
  const openings: Aperture[] = [
    aperture,
    { x: 594, y: 404, width: 0, height: 576, radius: 12 },
    { x: 1326, y: 404, width: 0, height: 576, radius: 12 },
    { x: 592, y: 784, width: 240, height: 0, radius: 12 },
    { x: 960, y: 784, width: 240, height: 0, radius: 12 },
    { x: 1328, y: 784, width: 240, height: 0, radius: 12 },
  ];
  const cardFrames: HTMLElement[] = [];
  function holePath(o: Aperture) {
    const l = o.x - o.width / 2,
      t = o.y - o.height / 2,
      r = o.x + o.width / 2,
      b = o.y + o.height / 2,
      k = Math.min(o.radius, o.width / 2, o.height / 2);
    return (
      'M' +
      (l + k) +
      ' ' +
      t +
      'H' +
      (r - k) +
      'Q' +
      r +
      ' ' +
      t +
      ' ' +
      r +
      ' ' +
      (t + k) +
      'V' +
      (b - k) +
      'Q' +
      r +
      ' ' +
      b +
      ' ' +
      (r - k) +
      ' ' +
      b +
      'H' +
      (l + k) +
      'Q' +
      l +
      ' ' +
      b +
      ' ' +
      l +
      ' ' +
      (b - k) +
      'V' +
      (t + k) +
      'Q' +
      l +
      ' ' +
      t +
      ' ' +
      (l + k) +
      ' ' +
      t +
      'Z'
    );
  }
  function drawAperture() {
    const paths = openings
      .filter((o) => o.width > 0.01 && o.height > 0.01)
      .map(holePath)
      .join(' ');
    const hole =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><path fill="white" fill-rule="evenodd" d="M0 0H1920V1080H0Z ' +
      paths +
      '"/></svg>';
    stage.style.maskImage =
      'url("data:image/svg+xml,' + encodeURIComponent(hole) + '")';
    cardFrames.forEach((e, i) => {
      const o = openings[i];
      e.style.left = o.x - o.width / 2 + 'px';
      e.style.top = o.y - o.height / 2 + 'px';
      e.style.width = o.width + 'px';
      e.style.height = o.height + 'px';
      e.style.borderRadius = o.radius + 'px';
      const caption = find(e, '.card-art');
      caption.style.height = o.height + 'px';
      caption.style.borderRadius = o.radius + 'px';
    });
  }
  stage.style.maskSize = '100% 100%';
  drawAperture();
  tl.to(
    aperture,
    { width: 324, duration: 0.65, ease: portraitEase, onUpdate: drawAperture },
    1,
  );
  part('aspect').style.cssText =
    'position:absolute;left:247px;top:30px;color:#8a8a8a;font:500 11px var(--font-inter);display:flex;gap:4px;align-items:center';
  part('aspect').innerHTML =
    '<span class="ratio-label">16:9</span> ' +
    icon('chevron-down', { size: 12 });
  tl.to(part('aspect'), { x: 350, duration: 0.65, ease: portraitEase }, 1);
  tl.set(find(ui, '.ratio-label'), { textContent: '9:16' }, 1.65);

  const tab = part('tab');
  all('tab')
    .slice(1)
    .forEach((e) => e.remove());
  tab.innerHTML =
    'Stream highlights <span style="font:500 11px var(--font-inter);color:#777">0:16</span>' +
    icon('chevron-down', { size: 12, color: '#999' });
  tab.style.cssText =
    'position:absolute;left:12px;top:2px;width:190px;height:32px;border-radius:8px;background:#1f1f1f;display:flex;gap:8px;align-items:center;padding-left:12px;font:500 12.8px var(--font-inter);color:#ededed';
  part('tab-add').style.left = '212px';

  const transport = part('transport');
  transport.innerHTML =
    '<span style="width:31px;display:grid;place-items:center">' +
    icon('skip-back', { size: 15, color: '#a5a7aa' }) +
    '</span><span style="width:32px;height:32px;border-radius:8px;background:#202020;display:grid;place-items:center">' +
    icon('pause', { size: 15, color: '#e8e8e8' }) +
    '</span><span style="width:34px;display:grid;place-items:center">' +
    icon('skip-forward', { size: 15, color: '#a5a7aa' }) +
    '</span><span style="margin-left:20px;font:500 13px var(--font-inter);color:#ececec;white-space:nowrap"><span class="clock">00:00:00</span><span style="color:#6d6f72"> / 00:16:00</span></span>';
  const tracks = part('timeline');
  tracks.innerHTML = '';
  const ruler = make(
    tracks,
    'ruler',
    'left:170px;top:2px;width:1329px;height:29px;border-bottom:1px solid #1b1b1b;color:#767676;font:400 10px var(--font-inter)',
  );
  for (let i = 0; i <= 8; i++)
    make(ruler, 'tick', 'left:' + i * 166 + 'px;top:7px;', String(i * 2) + 's');
  const gameplayLabel = make(
    tracks,
    'v1',
    'left:14px;top:66px;font:500 12px var(--font-inter);color:#d8d8d8;display:flex;gap:9px;align-items:center',
    '<span style="width:6px;height:6px;border-radius:50%;background:#35b874"></span>V1',
  );
  const audioLabel = make(
    tracks,
    'a1',
    'left:14px;top:148px;font:500 12px var(--font-inter);color:#d8d8d8;display:flex;gap:9px;align-items:center',
    '<span style="width:6px;height:6px;border-radius:50%;background:#aaa"></span>A1',
  );
  const lane = make(
    tracks,
    'lane',
    'left:170px;top:50px;width:1329px;height:64px;border:1px solid #4d7b66;border-radius:4px;overflow:hidden;background:#324f42',
  );
  const sourceTypes = [
    {
      creator: 'Shroud',
      content: 'CS2',
      poster: media.poster,
      faceSize: '676px 396px',
      facePosition: '-38px -287px',
    },
    {
      creator: 'Kai Cenat',
      content: 'Live moment',
      poster: media.kai,
      faceSize: '266px 199.5px',
      facePosition: '-110px -60px',
    },
    {
      creator: 'Duke Dennis',
      content: 'Basketball',
      poster: media.duke,
      faceSize: '288px 216px',
      facePosition: '-70px -65px',
    },
    {
      creator: 'CaseOh',
      content: 'Horror',
      poster: media.caseoh,
      faceSize: '336px 252px',
      facePosition: '-4px -97px',
    },
    {
      creator: 'xQc',
      content: 'Overwatch',
      poster: media.xqc,
      faceSize: '336px 252px',
      facePosition: '10px -52px',
    },
    {
      creator: 'Jynxzi',
      content: 'R6 clutch',
      poster: media.jynxzi,
      faceSize: '264px 198px',
      facePosition: '-71px -33px',
    },
  ];
  const clipSources = [0, 1, 2, 3, 4, 5, 0, 1, 4, 5].map((i) => sourceTypes[i]);
  for (let i = 0; i < 10; i++)
    make(
      lane,
      'thumbnail',
      'left:' +
        i * 132.9 +
        'px;top:0;width:132.9px;height:100%;overflow:hidden',
      '<img src="' +
        clipSources[i].poster +
        '" style="width:100%;height:100%;object-fit:cover;opacity:.82"/>',
    );
  const audioLane = make(
    tracks,
    'source-audio',
    'left:170px;top:134px;width:1329px;height:40px;border:1px solid #666;border-radius:4px;background:#343434;font:400 11px/28px var(--font-inter);padding:5px 9px;color:#ddd',
    'Stream highlights.m4a',
  );
  const original = make(
    lane,
    'original-label',
    'left:7px;top:5px;border-radius:3px;padding:3px 6px;background:#111b;font:400 10px var(--font-inter);color:#fff',
    'Stream highlights.mp4',
  );
  const cuts = [];
  for (let i = 1; i <= 9; i++) {
    const cut = make(
      tracks,
      'cut-mark',
      'left:' +
        (170 + i * 132.9 - 2) +
        'px;top:50px;width:4px;height:162px;background:#151515',
    );
    cuts.push(cut);
    const lab = make(
      lane,
      'scene-label',
      'left:' +
        (i * 132.9 + 6) +
        'px;top:5px;border-radius:3px;padding:3px 6px;background:#111b;font:400 10px var(--font-inter);color:#fff',
      String(i + 1).padStart(2, '0') + ' ' + clipSources[i].content,
    );
    tl.from(lab, { autoAlpha: 0, duration: 0.08 }, 1 + (i - 1) * 0.22);
  }
  const creatorLane = make(
    tracks,
    'creator-track',
    'left:170px;top:84px;width:1329px;height:44px;border:1px solid #4d7b66;border-radius:4px;overflow:hidden;background:#324f42',
  );
  for (let i = 0; i < 10; i++) {
    const source = clipSources[i];
    const cell = make(
      creatorLane,
      'creator-clip',
      'left:' +
        i * 132.9 +
        'px;top:0;width:132.9px;height:44px;overflow:hidden;border-right:4px solid #151515;background-image:url("' +
        source.poster +
        '");background-size:' +
        source.faceSize +
        ';background-position:' +
        source.facePosition +
        ';',
    );
    make(
      cell,
      'creator-label',
      'left:5px;top:4px;padding:2px 4px;border-radius:3px;background:#111b;font:400 10px var(--font-inter);color:#fff',
      source.creator,
    );
  }
  const creatorLabel = make(
    tracks,
    'v2',
    'left:14px;top:98px;font:500 12px var(--font-inter);color:#d8d8d8',
    'V2 <span style="margin-left:10px;color:#999">Creator</span>',
  );
  const captionsLane = make(
    tracks,
    'captions-track',
    'left:170px;top:50px;width:1329px;height:26px;overflow:hidden',
  );
  for (let i = 0; i < 10; i++)
    make(
      captionsLane,
      'caption-clip',
      'left:' +
        i * 132.9 +
        'px;top:0;width:128.9px;height:26px;border:1px solid #967650;border-radius:4px;background:#6b5137;padding:5px 6px;font:400 10px/14px var(--font-inter);color:#f2e5d4',
      'Captions ' + String(i + 1).padStart(2, '0'),
    );
  const captionsLabel = make(
    tracks,
    'v3',
    'left:14px;top:57px;font:500 12px var(--font-inter);color:#d8d8d8',
    'V3 <span style="margin-left:10px;color:#999">Captions</span>',
  );
  tl.to(lane, { y: 86, height: 44, duration: 0.65, ease: portraitEase }, 1);
  tl.to(gameplayLabel, { y: 84, duration: 0.65, ease: portraitEase }, 1);
  tl.set(
    gameplayLabel,
    {
      innerHTML: 'V1 <span style="margin-left:10px;color:#999">Content</span>',
    },
    1,
  );
  tl.to(
    audioLane,
    {
      y: 54,
      height: 24,
      paddingTop: 0,
      paddingBottom: 0,
      lineHeight: '22px',
      duration: 0.65,
      ease: portraitEase,
    },
    1,
  );
  tl.to(audioLabel, { y: 48, duration: 0.65, ease: portraitEase }, 1);
  tl.set(
    audioLabel,
    { innerHTML: 'A1 <span style="margin-left:10px;color:#999">Audio</span>' },
    1,
  );
  tl.from(
    creatorLane,
    { clipPath: 'inset(0 100% 0 0)', duration: 0.25, ease: portraitEase },
    1.5,
  );
  tl.from(creatorLabel, { autoAlpha: 0, duration: 0.15 }, 1.5);
  tl.from(captionsLane, { autoAlpha: 0, duration: 0.25 }, 1.65);
  tl.from(captionsLabel, { autoAlpha: 0, duration: 0.25 }, 1.65);
  const label01 = make(
    lane,
    'scene-label-first',
    'left:7px;top:5px;border-radius:3px;padding:3px 6px;background:#111b;font:400 10px var(--font-inter);color:#fff',
    '01 CS2',
  );
  const playhead = make(
    tracks,
    'playhead',
    'left:169px;top:8px;width:2px;height:236px;background:#aaa',
  );
  make(
    playhead,
    'cap',
    'left:-5px;top:0;width:12px;height:15px;background:#aaa;clip-path:polygon(0 0,100% 0,100% 65%,50% 100%,0 65%)',
  );
  const counter = make(
    side,
    'counter',
    'left:16px;top:205px;font:400 13.6px/22px var(--font-inter);color:#999;display:flex;gap:4px',
    '<span class="count">1</span><span>of 10 clips</span>',
  );
  const scan = make(
    lane,
    'scan',
    'left:0;top:0;width:100px;height:64px;background:linear-gradient(90deg,transparent,#ffffff50,transparent)',
  );
  const trimGap = make(
    tracks,
    'trim-gap',
    'left:687.6px;top:50px;width:14px;height:162px;background:#151515',
  );
  const trimEdge = make(
    tracks,
    'trim-edge',
    'left:701.6px;top:50px;width:2px;height:130px;background:#aaa',
  );
  tl.fromTo(
    trimGap,
    { clipPath: 'inset(0 0 0 100%)' },
    { clipPath: 'inset(0 0 0 0%)', duration: 0.35, ease: 'power3.inOut' },
    1.8,
  );
  tl.from(trimEdge, { autoAlpha: 0, duration: 0.1 }, 1.8);
  tl.to(trimEdge, { x: -14, duration: 0.35, ease: 'power3.inOut' }, 1.8);
  tl.to(trimEdge, { autoAlpha: 0, duration: 0.12 }, 2.3);
  const count = { value: 1 };
  const clock = { value: 0 };
  tl.to(
    clock,
    {
      value: 16,
      duration: 16,
      ease: 'none',
      onUpdate: () => {
        const s = Math.min(15, Math.floor(clock.value));
        const f = Math.floor((clock.value % 1) * 60);
        find(ui, '.clock').textContent =
          '00:' + String(s).padStart(2, '0') + ':' + String(f).padStart(2, '0');
      },
    },
    0,
  );
  tl.from(reply, { autoAlpha: 0, duration: 0.15 }, 0.1);
  tl.from(ready, { autoAlpha: 0, duration: 0.2 }, 3.15);
  tl.to(reply, { autoAlpha: 0, duration: 0.12 }, 3.05);
  tl.from(counter, { autoAlpha: 0, duration: 0.15 }, 0.5);
  tl.from(scan, { autoAlpha: 0, duration: 0.1 }, 0.15);
  tl.to(scan, { x: 1329, duration: 0.65, ease: 'power2.inOut' }, 0.25);
  tl.to(scan, { autoAlpha: 0, duration: 0.1 }, 0.9);
  cuts.forEach((cut, i) => {
    const at = 1 + i * 0.22;
    tl.from(
      cut,
      {
        scaleY: 0,
        transformOrigin: '50% 0%',
        duration: 0.18,
        ease: 'power3.out',
      },
      at,
    );
    tl.to(
      count,
      {
        value: i + 2,
        duration: 0.01,
        onUpdate: () => {
          find(ui, '.count').textContent = String(Math.round(count.value));
        },
      },
      at,
    );
  });
  tl.to(original, { autoAlpha: 0, duration: 0.08 }, 1);
  tl.from(label01, { autoAlpha: 0, duration: 0.08 }, 1);

  tl.to(playhead, { x: 1329, duration: 16, ease: 'none' }, 0);
  const selected = make(
    tracks,
    'selected-creator-segment',
    'left:170px;top:84px;width:128.9px;height:96px;pointer-events:none;',
  );
  make(
    selected,
    'selected-creator',
    'left:0;top:0;width:128.9px;height:44px;border:1px solid #bbb;border-radius:4px;',
  );
  make(
    selected,
    'selected-content',
    'left:0;top:52px;width:128.9px;height:44px;border:1px solid #bbb;border-radius:4px;',
  );
  tl.from(selected, { autoAlpha: 0, duration: 0 }, 100 / 60);
  tl.set(selected, { x: 3 * 132.9 }, 100 / 60);
  tl.set(selected, { x: 4 * 132.9 }, 139 / 60);
  tl.set(selected, { x: 6 * 132.9 }, 178 / 60);

  // The existing short carries into the montage on the same source clock.
  const montage = make(
    root,
    'montage',
    'inset:0;pointer-events:none;font-family:var(--font-inter);color:#f4f4f0',
  );
  const YOUTUBE =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 180"><path fill="red" d="M250.346 28.075A32.18 32.18 0 0 0 227.69 5.418C207.824 0 127.87 0 127.87 0S47.912.164 28.046 5.582A32.18 32.18 0 0 0 5.39 28.24c-6.009 35.298-8.34 89.084.165 122.97a32.18 32.18 0 0 0 22.656 22.657c19.866 5.418 99.822 5.418 99.822 5.418s79.955 0 99.82-5.418a32.18 32.18 0 0 0 22.657-22.657c6.338-35.348 8.291-89.1-.164-123.134"/><path fill="#fff" d="m102.421 128.06l66.328-38.418l-66.328-38.418z"/></svg>';

  const styling = [
    '<span style="background:#333;padding:5px 9px;border-radius:4px;font:600 12px var(--font-inter);letter-spacing:1.3px">SHROUD</span>',
    '<span style="font:700 30px/.95 var(--landing-font-head);letter-spacing:-1px;text-shadow:0 2px 12px #0009">KAI CENAT</span>',
    '<span style="background:#f4f4f0;color:#111;padding:6px 10px;font:700 19px var(--landing-font-head)">DUKE DENNIS</span>',
    '<span style="font:500 24px/1 var(--landing-font-head);letter-spacing:-.8px;text-shadow:0 2px 12px #0008">CASEOH</span>',
    '<span style="font:700 32px/.95 var(--landing-font-head);letter-spacing:-.8px;text-shadow:0 2px 12px #0009">xQc</span>',
    '<span style="font:600 24px/1.05 var(--landing-font-head);letter-spacing:-.6px;text-shadow:0 2px 12px #0008">JYNXZI</span>',
  ];
  const targets = [284600, 192400, 87600, 143800, 68100, 216700];
  openings.forEach((o, i) => {
    const frame = make(montage, 'short-card', 'left:0;top:0;width:0;height:0');
    const art = make(
      frame,
      'card-art',
      'inset:0;overflow:hidden;border:1px solid #ffffff22;border-radius:12px;background:linear-gradient(0deg,#0008,transparent 38%)',
    );
    make(art, 'style-caption', 'left:16px;right:12px;bottom:20px', styling[i]);
    const metric = make(
      frame,
      'view-badge',
      'left:0;top:calc(100% + 12px);height:28px;display:flex;align-items:center;gap:8px;white-space:nowrap;font:500 19px var(--font-inter);font-variant-numeric:tabular-nums',
      '<span style="width:24px;height:17px;display:block">' +
        YOUTUBE +
        '</span><span class="view-count">0</span><span style="color:#888;font:400 13px var(--font-inter)">views</span>',
    );
    find(metric, 'svg').style.cssText = 'display:block;width:24px;height:17px';
    const n = { value: 0 };
    const num = find(metric, '.view-count');
    tl.to(
      n,
      {
        value: targets[i],
        duration: 3.1,
        ease: 'power2.out',
        onUpdate: () => {
          num.textContent = Math.round(n.value).toLocaleString('en-US');
        },
      },
      7.7 + i * 0.04,
    );
    tl.from(metric, { autoAlpha: 0, duration: 0.3 }, 7.6);
    tl.from(
      frame,
      { autoAlpha: 0, duration: 0.18 },
      i === 0 ? 3.65 : i === 1 ? 3.65 : i === 2 ? 4.7 : 6.8 + (i - 3) * 0.15,
    );
    cardFrames.push(frame);
  });
  const credit = make(
    montage,
    'example-note',
    'left:52px;bottom:42px;color:#696969;font:400 12px var(--font-inter);letter-spacing:.1px',
    'Illustrative view counts',
  );
  tl.from(credit, { autoAlpha: 0, duration: 0.4 }, 7.6);
  tl.to(window, { autoAlpha: 0, duration: 3.15, ease: 'power1.inOut' }, 3.65);
  tl.set(window, { display: 'none' }, 6.8);
  tl.to(
    aperture,
    {
      x: 960,
      radius: 12,
      duration: 0.7,
      ease: portraitEase,
      onUpdate: drawAperture,
    },
    3.65,
  );
  tl.to(
    openings[1],
    {
      x: 570,
      width: 324,
      duration: 0.7,
      ease: portraitEase,
      onUpdate: drawAperture,
    },
    3.65,
  );
  tl.to(
    openings[2],
    {
      x: 1350,
      width: 324,
      duration: 0.65,
      ease: portraitEase,
      onUpdate: drawAperture,
    },
    4.7,
  );
  tl.to(
    aperture,
    {
      x: 960,
      y: 272,
      width: 240,
      height: 426.6666666667,
      duration: 1,
      ease: portraitEase,
      onUpdate: drawAperture,
    },
    5.8,
  );
  tl.to(
    openings[1],
    {
      x: 592,
      y: 272,
      width: 240,
      height: 426.6666666667,
      duration: 1,
      ease: portraitEase,
      onUpdate: drawAperture,
    },
    5.8,
  );
  tl.to(
    openings[2],
    {
      x: 1328,
      y: 272,
      width: 240,
      height: 426.6666666667,
      duration: 1,
      ease: portraitEase,
      onUpdate: drawAperture,
    },
    5.8,
  );
  openings.slice(3).forEach((o, i) =>
    tl.to(
      o,
      {
        height: 426.6666666667,
        duration: 0.5,
        ease: portraitEase,
        onUpdate: drawAperture,
      },
      6.8 + i * 0.15,
    ),
  );
  drawAperture();

  return { stage, montage };
}
