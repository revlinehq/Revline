import { icon, logo } from './clippers-dom';

/** Static illustration of the source editor. Its painted controls are not inputs. */
export function createEditor(root: HTMLElement) {
  const W = 1920,
    H = 1080;
  const ui = document.createElement('div');
  ui.style.cssText = `position:absolute;inset:0;background:#111;font-family:var(--font-inter),sans-serif;color:#e7e7e8;overflow:hidden;-webkit-font-smoothing:antialiased`;
  root.appendChild(ui);
  const el = (part: string, css: string, html = '', parent = ui) => {
    const d = document.createElement('div');
    d.dataset.part = part;
    d.style.cssText = 'position:absolute;box-sizing:border-box;' + css;
    d.innerHTML = html;
    parent.appendChild(d);
    return d;
  };
  // The illustration uses the app's Lucide icons.
  const ic = (name: string, size = 16, color = 'currentColor', w = 2) =>
    icon(name, { size, color, strokeWidth: w });
  const T = (text: string, css: string) =>
    `<span style="position:absolute;white-space:nowrap;${css}">${text}</span>`;
  const SIDE = 401,
    TL = 332;

  // Header: logo and title from the left, MCP pill, Export and avatar anchored right.
  const header = el(
    'header',
    `left:0;top:0;width:${W}px;height:56px;border-bottom:1px solid #1e1f21;background:#111`,
  );
  const logoSvg = logo.replace(
    '<svg',
    '<svg width="26" height="26" style="color:#f2f2f2"',
  );
  el(
    'logo',
    'left:20px;top:14px;height:28px;display:flex;align-items:center;gap:8px',
    `${logoSvg}<span style="font:600 24px var(--landing-font-head);letter-spacing:-.5px;color:#f2f2f2">revline</span>`,
    header,
  );
  {
    el(
      'header-divider',
      `left:142px;top:17px;width:1px;height:22px;background:#18191b`,
      '',
      header,
    );
    el(
      'project-title',
      'left:175px;top:17px;font:500 14px var(--font-inter);color:#e6e6e6;display:flex;align-items:center;gap:8px;white-space:nowrap',
      `Instagram algorithm (engine tests)<span style="color:#8d8d8d">${ic('chevron-down', 14)}</span>`,
      header,
    );
    el(
      'mcp-pill',
      'right:148px;top:13px;width:140px;height:30px;border:1px solid #232528;background:#1a1a1a;border-radius:8px;font:500 13px var(--font-inter);color:#e2e2e2;display:flex;align-items:center;gap:7px;padding-left:12px',
      `<span style="color:#d97757">${ic('link-2', 13, '#aaa')}</span>MCP connected`,
      header,
    );
  }
  el(
    'export',
    'right:55px;top:13px;width:84px;height:30px;background:#3a3a3a;border-radius:8px;font:500 13px var(--font-inter);color:#fff;display:flex;align-items:center;justify-content:center;gap:6px',
    `Export${ic('download', 14, '#fff', 2)}`,
    header,
  );
  el(
    'avatar',
    `right:16px;top:12px;width:32px;height:32px;border-radius:50%;background:url(/landing/clippers-avatar.webp) center/cover`,
    '',
    header,
  );

  // Chat sidebar: messages from the top, composer anchored to the bottom.
  const side = el(
    'sidebar',
    `left:0;top:56px;width:${SIDE}px;height:${H - 56}px;background:#151515;border-right:1px solid #212224;overflow:hidden`,
  );
  const composer = el(
    'composer',
    `left:16px;bottom:12px;width:${SIDE - 33}px;height:104px;background:#252525;border:1px solid #2e2e2e;border-radius:9px`,
    T(
      'What would you change next?',
      'left:14px;top:14px;font:400 14px var(--font-inter);color:#8c8c8c',
    ) +
      T(
        `GPT-6.1 Terra ${ic('chevron-down', 13)}`,
        'left:56px;top:68px;font:500 13px var(--font-inter);color:#bdbdbd;display:flex;align-items:center;gap:6px',
      ) +
      T(
        `Medium ${ic('chevron-down', 13)}`,
        'left:174px;top:68px;font:500 13px var(--font-inter);color:#bdbdbd;display:flex;align-items:center;gap:6px',
      ),
    side,
  );
  // The attach button: the source screen lost it under a painted-over dev badge; the app has it here.
  el(
    'attach',
    'left:12px;top:68px;color:#9a9a9a',
    ic('plus', 17, '#9a9a9a'),
    composer,
  );
  el(
    'send',
    'right:9px;top:62px;width:31px;height:31px;background:#3a3a3a;border-radius:8px;display:grid;place-items:center',
    ic('arrow-up', 15, '#ddd', 2),
    composer,
  );

  // Preview stage: takes the space between the sidebar and the timeline; the 9:16 frame stays centered.
  const SW = W - 401,
    SH = H - 56 - TL,
    f = Math.min(1, (SH - 130) / 448),
    FW = 252 * f,
    FH = 448 * f,
    FX = (SW - FW) / 2,
    FY = (SH - FH) / 2 + 15 * f;
  const stage = el(
    'stage',
    `left:401px;top:56px;width:${SW}px;height:${SH}px;background:#111`,
  );
  el(
    'panel-toggle',
    'left:20px;top:12px;color:#7d7f83',
    ic('panel-left', 16),
    stage,
  );
  el(
    'aspect',
    `left:${FX}px;top:${FY - 28}px;font:500 11px var(--font-inter);color:#8a8a8a;display:flex;align-items:center;gap:4px`,
    `9:16${ic('chevron-down', 12)}`,
    stage,
  );
  const video = el(
    'video-frame',
    `left:${FX}px;top:${FY}px;width:252px;height:448px;transform:scale(${f});transform-origin:0 0;background:#000;overflow:hidden`,
    '',
    stage,
  );
  el(
    'side-handle',
    `right:0;top:${(SH - 96) / 2}px;width:30px;height:96px;background:#1a1a1a;border:1px solid #232427;border-right:0;border-radius:12px 0 0 12px;display:grid;place-items:center`,
    ic('chevron-left', 20, '#b5b5b5', 1.4),
    stage,
  );

  // Timeline: tabs, toolbar (left tools, centered transport, right tools), ruler, tracks and clips.
  const tabs = el(
    'timeline-tabs',
    `left:401px;top:${H - TL}px;width:${SW}px;height:38px;border-bottom:1px solid #1b1c1e`,
  );
  const tab = (
    name: string,
    time: string,
    x: number,
    w: number,
    active = false,
  ) =>
    el(
      'tab',
      `left:${x - 401}px;top:2px;width:${w}px;height:32px;border-radius:8px;background:${active ? '#222' : '#222'};display:flex;align-items:center;gap:8px;padding-left:12px;white-space:nowrap;font:500 12.8px var(--font-inter);color:${active ? '#ededed' : '#a9abad'}`,
      `${name}<span style="font:500 11px ui-monospace,Menlo,monospace;color:#6c6e70">${time}</span>${active ? `<span style="color:#9a9a9a;margin-left:2px">${ic('chevron-down', 13)}</span>` : ''}`,
      tabs,
    );
  tab('Stream highlights', '0:16', 413, 190, true);
  el('tab-add', 'left:857px;top:9px;color:#9a9a9a', ic('plus', 16), tabs);
  const bar = el(
    'toolbar',
    `left:401px;top:${H - TL + 39}px;width:${SW}px;height:43px;background:#151515`,
  );
  const tool = (
    part: string,
    name: string,
    css: string,
    color = '#8d8f93',
    size = 16,
  ) =>
    el(
      part,
      `top:${21 - size / 2}px;color:${color};${css}`,
      ic(name, size, color),
      bar,
    );
  tool('cut', 'scissors', 'left:15px');
  tool('undo', 'undo-2', 'left:47px');
  tool('redo', 'redo-2', 'left:78px', '#45474b');
  tool('delete', 'trash-2', 'left:109px', '#5b5d61');
  el(
    'transport',
    `left:${SW / 2 - 123}px;top:0;height:43px;display:flex;align-items:center;gap:0`,
    `<span style="color:#a5a7aa;width:31px;display:grid;place-items:center">${ic('skip-back', 15, '#a5a7aa')}</span><span style="width:32px;height:32px;border-radius:8px;background:#222;display:grid;place-items:center">${ic('play', 15, '#e8e8e8')}</span><span style="width:34px;display:grid;place-items:center">${ic('skip-forward', 15, '#a5a7aa')}</span><span style="margin-left:20px;font:500 13px var(--font-inter);color:#ececec;letter-spacing:.08px;white-space:nowrap">00:00:00 <span style="color:#6d6f72;font-weight:400">&nbsp;/ 01:08:14</span></span>`,
    bar,
  );
  tool('fit', 'chevrons-right-left', 'right:194px', '#a0a2a5', 15);
  tool('compact', 'rows-3', 'right:173px', '#aaa', 15);
  tool('ai-glow', 'orbit', 'right:152px', '#aaa', 15);
  el(
    'zoom',
    'right:77px;top:19px;width:68px;height:4px;border-radius:2px;background:#2c2c2c',
    '<div style="width:45px;height:4px;border-radius:2px;background:#999"></div><div style="position:absolute;left:39px;top:-5px;width:14px;height:14px;border-radius:50%;background:#ccc"></div>',
    bar,
  );
  tool('more', 'ellipsis', 'right:47px', '#9a9c9f');
  tool('collapse', 'chevron-down', 'right:15px', '#9a9c9f');
  const tracks = el(
    'timeline',
    `left:401px;top:${H - 250}px;width:${SW}px;height:250px;background:#151515;overflow:hidden`,
  );
  return ui;
}
