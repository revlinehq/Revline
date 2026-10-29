// T3 Code film, first beat, as a React scene: the dashboard assembles, the camera dives into the
// composer, a prompt is typed and sent, and the reply streams in. Ported from the GSAP scene
// "T3 Code film" (clip 776110f8, dev project j972wnjj), local seconds 0 to 8.15.
import { memo, type CSSProperties, type ReactNode } from 'react';
import { Beat, Icon, Layer, mix, progress, useBeat, useScene } from 'revline';

const MUTED = '#7b7b7f', DIM = '#5c5c60';
const APP = { width: 860, height: 538 };

// ---------- Small pieces ----------

const Box = ({ part, style, children }: { part?: string; style?: CSSProperties; children?: ReactNode }) =>
  <div data-part={part} style={{ position: 'absolute', boxSizing: 'border-box', ...style }}>{children}</div>;
const At = ({ x, y, style, children }: { x: number; y: number; style?: CSSProperties; children?: ReactNode }) =>
  <span style={{ position: 'absolute', left: x, top: y, whiteSpace: 'nowrap', fontSize: 8, lineHeight: 1, ...style }}>{children}</span>;
const I = ({ name, size = 9, color = 'currentColor', stroke = 2 }: { name: string; size?: number; color?: string; stroke?: number }) =>
  <Icon name={name} size={size} color={color} strokeWidth={stroke} style={{ display: 'inline-block', verticalAlign: '-.15em' }} />;
const Sp = () => <>{' '}</>;

const ClaudeMark = ({ size, block }: { size: number; block?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#d97757" strokeWidth={2.4} strokeLinecap="round" style={block ? { display: 'block' } : { display: 'inline-block', verticalAlign: '-.15em' }}>
    <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
  </svg>
);
const Cloud = ({ size, color = '#9a9aa0' }: { size: number; color?: string }) => (
  <span style={{ position: 'relative', display: 'inline-block', width: size, height: size, verticalAlign: '-.2em' }}>
    <I name="cloud" size={size} color={color} />
    <span style={{ position: 'absolute', left: 0, right: 0, top: size * 0.5, textAlign: 'center', font: `700 ${size * 0.36}px/1 Inter`, color }}>co</span>
  </span>
);
const T3Avatar = ({ size }: { size: number }) => (
  <span style={{ display: 'inline-grid', placeItems: 'center', width: size, height: size, borderRadius: '50%', background: '#2f6fe4', font: `700 ${size * 0.5}px/1 Inter`, color: '#fff', verticalAlign: '-.15em' }}>T3</span>
);
const Gradient = ({ children }: { children: ReactNode }) =>
  <span style={{ background: 'linear-gradient(90deg,#ffffff,#c9b6ff)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{children}</span>;

// ---------- The sidebar sky (T3's header art) ----------

const SKY = { top: 'oklch(0.283792 0.117327 297.201)', mid: 'oklch(0.227147 0.086086 277.99)', bottom: 'oklch(0.200528 0.055699 261.216)', highlight: 'oklch(0.707246 0.157418 252.091)', secondary: 'oklch(0.600473 0.182225 277.296)', tertiary: 'oklch(0.62583 0.210886 305.994)', line: 'oklch(0.938794 0.029114 273.103)', glowHighlight: 'oklch(0.553749 0.176543 271.958)', glowSecondary: 'oklch(0.345571 0.117466 273.568)', sparkle: 'oklch(0.880867 0.057747 269.011)' };
const STARS = [[14, 10, .6, .85], [38, 22, .4, .55], [58, 8, .5, .7], [84, 16, .4, .5], [104, 7, .6, .8], [126, 20, .4, .55], [148, 11, .5, .7], [170, 24, .4, .5], [192, 9, .6, .8], [214, 18, .4, .55], [236, 8, .5, .7], [258, 20, .45, .6], [278, 11, .55, .75], [26, 34, .4, .45], [118, 34, .4, .45], [202, 32, .4, .5], [268, 34, .4, .45]];
const Stop = ({ color, opacity = 1, offset = 0 }: { color: string; opacity?: number; offset?: number }) => <stop offset={offset} style={{ stopColor: color }} stopOpacity={opacity} />;

function Sky({ id }: { id: string }) {
  return (
    <svg width="100%" height="100%" fill="none" preserveAspectRatio="xMinYMin slice" viewBox="0 0 8192 96" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`${id}s`} x1="24" y1="0" x2="264" y2="96" gradientUnits="userSpaceOnUse" spreadMethod="reflect"><Stop color={SKY.bottom} /><Stop color={SKY.mid} offset={.5} /><Stop color={SKY.top} offset={1} /></linearGradient>
        <radialGradient id={`${id}g`} cx="0" cy="0" r="1" gradientTransform="translate(216 18) rotate(137) scale(120 84)" gradientUnits="userSpaceOnUse"><Stop color={SKY.glowHighlight} opacity={.4} /><Stop color={SKY.glowSecondary} opacity={.16} offset={.5} /><Stop color={SKY.bottom} opacity={0} offset={1} /></radialGradient>
        <linearGradient id={`${id}c`} x1="0" y1="60" x2="288" y2="96" gradientUnits="userSpaceOnUse"><Stop color={SKY.highlight} opacity={.5} /><Stop color={SKY.secondary} opacity={.62} offset={.52} /><Stop color={SKY.tertiary} opacity={.5} offset={1} /></linearGradient>
        <filter id={`${id}f`} x="-24" y="-24" width="336" height="144" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="4" /></filter>
        <pattern id={`${id}t`} width="288" height="96" patternUnits="userSpaceOnUse">
          <g style={{ fill: SKY.line }}>{STARS.map(([x, y, r, o], i) => <circle key={i} cx={x} cy={y} r={r} fillOpacity={o} />)}</g>
          <g style={{ stroke: SKY.sparkle }} strokeLinecap="round" strokeOpacity=".7" strokeWidth=".6">{[[70, 28], [160, 36], [246, 26]].map(([x, y]) => <path key={x} d={`M${x - 1.5} ${y}H${x + 1.5}M${x} ${y - 1.5}V${y + 1.5}`} />)}</g>
        </pattern>
        <pattern id={`${id}p`} width="640" height="96" patternUnits="userSpaceOnUse"><rect width="640" height="96" fill={`url(#${id}g)`} /></pattern>
      </defs>
      <rect width="100%" height="96" fill={`url(#${id}s)`} /><rect width="100%" height="96" fill={`url(#${id}p)`} /><rect width="100%" height="96" fill={`url(#${id}t)`} />
      <g filter={`url(#${id}f)`}><path d="M-12 88C-12 74 0 63 14 63C18 50 30 41 44 41C58 41 70 49 74 62C79 57 86 54 94 54C110 54 123 66 124 82C132 83 138 88 141 96H-12V88Z" fill={`url(#${id}c)`} /></g>
      <g filter={`url(#${id}f)`}><path d="M150 96C151 84 161 75 173 75C176 64 186 57 198 57C210 57 220 64 223 75C231 75 238 80 241 87C250 87 257 91 260 96H150Z" fill={`url(#${id}c)`} fillOpacity=".8" /></g>
    </svg>
  );
}

// ---------- Static app panels: memoized, so they render once per mount ----------

type Thread = { project: string; icon: string; title: string; branch: string; age: string; selected?: boolean; pinned?: boolean; alarm?: boolean; agent: 'claude' | 'codex' };
const THREADS: Thread[] = [
  { project: 'fleet', icon: 'laptop', title: 'Compare Fable and Sol Coding ...', branch: 'main', age: '14h', pinned: true, agent: 'claude' },
  { project: 'fleet', icon: 'laptop', title: 'Add Clear Work Status Guidance', branch: 'main', age: '5h', pinned: true, alarm: true, agent: 'codex' },
  { project: 't3code-3', icon: 't3', title: 'Keep Settled Responses Visible', branch: 't3code/show-substan...', age: '13d', selected: true, agent: 'codex' },
  { project: 't3code-3', icon: 't3', title: 'T3 Code Marketing Site Redesi...', branch: 't3code/refresh-marketing-site', age: '2h', agent: 'claude' },
  { project: 'trmnltokens', icon: 'monitor', title: 'Redesign Rolling 30-Day Token...', branch: '', age: '2h', agent: 'claude' },
  { project: 'fleet', icon: 'laptop', title: 'Restore Thread Progress Status', branch: 'main', age: '1d', agent: 'codex' },
];
const sky: CSSProperties = { position: 'absolute', left: 0, top: 0, width: 152, height: 40, overflow: 'hidden', borderRadius: '8px 0 0 0', WebkitMaskImage: 'linear-gradient(to bottom,black 0%,black 55%,transparent 92%)', maskImage: 'linear-gradient(to bottom,black 0%,black 55%,transparent 92%)' };

const SidebarBody = memo(function SidebarBody({ id }: { id: string }) {
  return <>
    <div style={sky}><Sky id={id} /></div>
    <At x={12} y={10}><I name="panel-left" color="#c8d4ff" /></At>
    <At x={31} y={9} style={{ font: '600 9px Inter', color: '#fff' }}>T3 <span style={{ color: '#9fb4ff' }}>Code</span></At>
    <At x={10} y={40}><I name="search" color="#9a9aa0" /></At><At x={24} y={39} style={{ font: '400 8px Inter', color: '#b9b9be' }}>Search</At><At x={132} y={40}><I name="square-pen" size={8} color="#77777c" /></At>
    <At x={10} y={62}><I name="folder" color="#9a9aa0" /></At><At x={24} y={61} style={{ font: '400 8px Inter', color: '#b9b9be' }}>All projects</At><At x={132} y={62}><I name="folder-plus" size={8} color="#77777c" /></At>
    <At x={11} y={392} style={{ font: '400 7px Inter', color: DIM }}>Settled (143)</At>
    <At x={12} y={515}><I name="settings" size={8} color={DIM} /></At><At x={32} y={515}><I name="git-compare" size={8} color={DIM} /></At><At x={52} y={515}><I name="chart-column" size={8} color={DIM} /></At>
    {THREADS.map((thread, index) => (
      <Box key={index} style={{ left: 0, top: 84 + index * 50, width: 152, height: 46 }}>
        <div style={{ position: 'absolute', left: 5, top: 0, width: 142, height: 46, borderRadius: 6, background: thread.selected ? '#1a1a1d' : undefined }} />
        <At x={11} y={4} style={{ font: '400 7px Inter', color: MUTED }}>{thread.icon === 't3' ? <T3Avatar size={8} /> : <I name={thread.icon} size={8} color="#9a9aa0" />}<Sp /> {thread.project}</At>
        <At x={thread.pinned ? thread.alarm ? 104 : 116 : 128} y={4} style={{ font: '400 7px Inter', color: thread.age === '2h' ? '#e5876f' : '#77777c' }}>
          {thread.pinned && <><I name="pin" size={7} color="#77777c" /><Sp /></>}{thread.alarm && <><I name="alarm-clock" size={7} color="#77777c" /><Sp /></>}{thread.age}
        </At>
        <At x={11} y={16} style={{ font: '500 8px Inter', color: thread.selected || index === 1 ? '#f2f2f3' : '#a7a7ac' }}>{thread.title}</At>
        <At x={11} y={29} style={{ font: '400 6.5px Inter', color: DIM }}>{thread.selected ? <><I name="folder-git-2" size={7} color={DIM} /><Sp /> {thread.branch} <span style={{ color: '#8b8cf0', marginLeft: 6 }}>#7723</span></> : thread.branch}</At>
        <At x={134} y={27}>{thread.agent === 'claude' ? <ClaudeMark size={8} /> : <Cloud size={9} />}</At>
      </Box>
    ))}
  </>;
});

const HeaderButton = ({ x, icon }: { x: number; icon: string }) => (
  <div style={{ position: 'absolute', left: x, top: 7, width: 38, height: 17, borderRadius: 5, boxShadow: 'inset 0 0 0 1px #26262a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, color: '#b5b5ba' }}><I name={icon} size={8} /><I name="chevron-down" size={7} /></div>
);
const HeaderBody = memo(function HeaderBody() {
  return <>
    <At x={14} y={11} style={{ font: '400 8px Inter', color: MUTED }}>t3code-3</At><At x={56} y={11} style={{ font: '400 8px Inter', color: DIM }}>/</At>
    <At x={66} y={11} style={{ font: '500 8px Inter', color: '#ededee' }}>Keep Settled Responses Visible</At>
    <HeaderButton x={262} icon="plus" /><HeaderButton x={304} icon="box" /><HeaderButton x={346} icon="github" />
  </>;
});

const Merged = () => (
  <span style={{ display: 'inline-block', marginLeft: 5, padding: '0 5px', borderRadius: 4, boxShadow: 'inset 0 0 0 1px rgba(63,185,80,.5)', color: '#3fb950', font: '600 6.5px/11px Inter' }}>
    <Icon name="check" size={7} color="#3fb950" strokeWidth={3} style={{ display: 'inline-block', verticalAlign: '-.1em' }} /> Merged
  </span>
);
/** The reply, one element per line so each can be revealed on its own. */
const answerLines = (merged: boolean, reveal: (index: number) => CSSProperties): ReactNode[] => [
  <At key="pr" x={0} y={0} style={reveal(0)}>Implemented and filed <span style={{ color: '#7aa7ff' }}><I name="github" size={7} color="#cfcfd3" /> PR #7723</span>{merged && <Merged />}.</At>,
  <div key="fix" style={{ position: 'absolute', left: 0, top: 19, width: 340, ...reveal(1) }}>The fix keeps the first and final assistant messages visible on web and mobile. Tool work and middle narration remain folded.</div>,
  <At key="passed" x={0} y={52} style={reveal(2)}>Validation passed:</At>,
  ...['51 focused tests', 'Web and mobile typechecks', 'Targeted lint and formatting', 'Exact issue reproduction', 'Clean diff check'].map((text, index) => <At key={text} x={4} y={70 + index * 16} style={reveal(3 + index)}>{'•  '}{text}</At>),
  <At key="ci" x={0} y={152} style={reveal(8)}>The PR is real, mergeable, and CI is queued.</At>,
];
const ANSWER_COUNT = 9;

const FilesBody = memo(function FilesBody() {
  return <>
    <At x={10} y={7} style={{ font: '500 7px Inter', color: '#d8d8dc' }}><span style={{ color: DIM }}>{'›'}</span><Sp /> 2 changed files <span style={{ color: '#3fb950' }}>+29</span> <span style={{ color: '#f85149' }}>{'−12'}</span> <span style={{ color: DIM, fontSize: 6.5 }}><Sp />Show files</span></At>
    <div style={{ position: 'absolute', right: 8, top: 4, height: 16, padding: '0 6px', borderRadius: 5, boxShadow: 'inset 0 0 0 1px #2a2a2e', display: 'flex', alignItems: 'center', gap: 3, font: '500 7px Inter', color: '#d8d8dc' }}><I name="file-text" size={7} />Open diff</div>
  </>;
});

// The composer is laid out from T3's 735px design at 0.49 scale.
const U = .49, ROW = 53.4, TEXT = 6.9;
const Cq = ({ x, y, style, children }: { x: number; y: number; style?: CSSProperties; children?: ReactNode }) =>
  <span style={{ position: 'absolute', left: x, top: y, whiteSpace: 'nowrap', lineHeight: 1, font: `400 ${TEXT}px Inter`, ...style }}>{children}</span>;
const Ci = ({ name, x, size = TEXT }: { name: string; x: number; size?: number }) =>
  <Cq x={x} y={ROW - size / 2}><Icon name={name} size={size} color="#969696" /></Cq>;
const ComposerChrome = memo(function ComposerChrome() {
  return <>
    <Cq x={8} y={ROW - 3.6}><ClaudeMark size={7.2} block /></Cq>
    <Cq x={39 * U} y={ROW - TEXT / 2} style={{ color: '#c7c7c7' }}>Claude Opus 5.5</Cq><Ci name="chevron-down" x={155 * U} size={5.4} />
    <Ci name="brain" x={183 * U} /><Cq x={204 * U} y={ROW - TEXT / 2} style={{ color: '#c7c7c7' }}>High</Cq><Ci name="chevron-down" x={242 * U} size={5.4} />
    <Ci name="lock-open" x={269 * U} /><Cq x={291 * U} y={ROW - TEXT / 2} style={{ color: '#c7c7c7' }}>Full access</Cq><Ci name="chevron-down" x={371 * U} size={5.4} />
    <Ci name="paperclip" x={656 * U - 3.6} size={7.4} />
  </>;
});
const promptText: CSSProperties = { position: 'absolute', left: 16 * U, top: 13.2 - TEXT / 2, font: `400 ${TEXT}px/1 Inter`, whiteSpace: 'nowrap' };

const footerSide: CSSProperties = { position: 'absolute', top: 6 + 7.8 - 3.2, display: 'flex', alignItems: 'center', gap: 2.5, font: '400 6.2px/1 Inter', color: '#969696', whiteSpace: 'nowrap' };
const FooterBody = memo(function FooterBody() {
  return <>
    <span style={{ ...footerSide, left: 20 * U }}><Icon name="folder" size={6.4} color="#969696" />Current checkout<Icon name="chevron-down" size={5} color="#969696" /></span>
    <span style={{ ...footerSide, right: 19 * U }}><Icon name="git-branch" size={6.4} color="#969696" />main<Icon name="chevron-down" size={5} color="#969696" /></span>
  </>;
});

const DiffHeadBody = memo(function DiffHeadBody() {
  return <>
    <At x={14} y={11} style={{ font: '500 7.5px Inter', color: '#d8d8dc' }}><I name="file-diff" size={8} color="#d8d8dc" /> Diff <Sp /><span style={{ color: DIM }}>+</span></At>
    <At x={268} y={11}><I name="maximize-2" size={8} color="#9a9aa0" /> <Sp /><I name="panel-bottom" size={8} color="#9a9aa0" /> <Sp /><I name="columns-2" size={8} color="#9a9aa0" /></At>
    <At x={12} y={36} style={{ font: '500 7px Inter', color: '#d8d8dc' }}>Turn 2 <I name="chevron-down" size={7} /></At>
    <At x={170} y={36} style={{ font: '500 6.5px Inter' }}><span style={{ color: '#3fb950' }}>+29</span> <span style={{ color: '#f85149' }}>{'−12'}</span></At>
    <At x={14} y={60} style={{ font: '400 7px Inter', color: '#c9c9ce' }}><span style={{ color: '#58a6ff' }}>{'⌄ ▣'}</span><Sp /> apps/mobile/src/lib/threadActivity.ts</At>
    <At x={278} y={60} style={{ font: '500 6.5px Inter' }}><span style={{ color: '#f85149' }}>-4</span> <span style={{ color: '#3fb950' }}>+15</span></At>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 77, textAlign: 'center', font: '400 6px Inter', color: DIM }}>1143 unmodified lines</div>
  </>;
});

// ---------- Diff hunks with light syntax colouring ----------

const TOKEN = /("[^"]*")|\b(const|new|for|of|if|continue)\b|\b(ReadonlyArray|ThreadFeedEntry|ThreadFeedLatestTurn|ReadonlyMap|ThreadFeedTurnFold|Map|Set|TurnId)\b|\.(has|set|get|filter|map)\(/g;
function Code({ line }: { line: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    parts.push(line.slice(last, match.index));
    const [, string, keyword, type, method] = match;
    parts.push(method ? <>.<span style={{ color: '#d2a8ff' }}>{method}</span>(</> : <span style={{ color: string ? '#a5d6ff' : keyword ? '#ff7b72' : '#ffa657' }}>{match[0]}</span>);
    last = match.index! + match[0].length;
  }
  parts.push(line.slice(last));
  return <>{parts.map((part, index) => <span key={index}>{part}</span>)}</>;
}
type Row = [number, ' ' | '+' | '-', string[]];
const LINE = 12.2;
const HUNKS: { part: string; top: number; rows: Row[]; note?: string; last?: boolean }[] = [
  { part: 'hunk-a', top: 88, rows: [[1144, ' ', ['  feed: ReadonlyArray<ThreadFeedEntry>,']], [1145, ' ', ['  latestTurn: ThreadFeedLatestTurn | null,']], [1146, ' ', ['): ReadonlyMap<string, ThreadFeedTurnFold> {']], [1147, '+', ['  const firstAssistantMessageIdByTurn = new Map<TurnId,', 'string>();']], [1148, ' ', ['  const terminalAssistantMessageIdByTurn = new Map<TurnId,', 'string>();']], [1149, ' ', ['  for (const entry of feed) {']], [1150, ' ', ['    if (entry.type === "message" && entry.message.role ===', '"assistant" && entry.message.turnId) {']]] },
  { part: 'hunk-b', top: 88 + 10 * LINE, note: '41 unmodified lines', rows: [[1151, '+', ['      if', '(!firstAssistantMessageIdByTurn.has(entry.message.turnId))', '{']], [1152, '+', ['', 'firstAssistantMessageIdByTurn.set(entry.message.turnId,', 'entry.id);']], [1153, '+', ['      }']], [1154, ' ', ['', 'terminalAssistantMessageIdByTurn.set(entry.message.turnId,', 'entry.id);']], [1155, ' ', ['    }']], [1156, ' ', ['  }']]] },
  { part: 'hunk-c', top: 88 + 23 * LINE, last: true, rows: [[1198, ' ', ['      continue;']], [1199, ' ', ['    }']], [1200, ' ', ['']], [1201, '+', ['    const firstAssistantMessageId =', 'firstAssistantMessageIdByTurn.get(turnId);']], [1202, ' ', ['    const terminalAssistantMessageId =', 'terminalAssistantMessageIdByTurn.get(turnId);']], [1203, ' ', ['    const hiddenEntryIds = new Set(']], [1199, '-', ['      entries.filter((entry) => entry.id !==', 'terminalAssistantMessageId).map((entry) => entry.id),']], [1204, '+', ['      entries']], [1205, '+', ['        .filter(']], [1206, '+', ['          (entry) =>']]] },
];
const hunkHeight = (rows: Row[]) => rows.reduce((sum, row) => sum + row[2].length, 0) * LINE;
const HunkBody = memo(function HunkBody({ rows, note }: { rows: Row[]; note?: string }) {
  let top = 0;
  return <>
    {rows.map(([number, sign, lines], index) => {
      const at = top; top += lines.length * LINE;
      return (
        <Box key={index} style={{ left: 0, top: at, width: 320, height: lines.length * LINE, background: sign === '+' ? 'rgba(46,160,67,.13)' : sign === '-' ? 'rgba(248,81,73,.16)' : 'transparent', boxShadow: sign === '+' ? 'inset 2px 0 0 #2ea043' : sign === '-' ? 'inset 2px 0 0 #f85149' : undefined }}>
          <span style={{ position: 'absolute', left: 8, top: 0, color: sign === '-' ? '#f85149' : sign === '+' ? '#7ee787' : '#6e7681' }}>{number}</span>
          {lines.map((line, row) => <span key={row} style={{ position: 'absolute', left: 34, top: row * LINE, whiteSpace: 'pre' }}><Code line={line} /></span>)}
        </Box>
      );
    })}
    {note && <Box style={{ left: 0, right: 0, bottom: -11, textAlign: 'center', font: '400 6px Inter', color: DIM }}>{note}</Box>}
  </>;
});

// ---------- The app ----------

const PART: Record<string, CSSProperties> = {
  window: { inset: 0, borderRadius: 8, background: '#0b0b0c', boxShadow: '0 0 0 1px rgba(255,255,255,.12)' },
  sidebar: { left: 0, top: 0, width: 152, height: 538, borderRadius: '8px 0 0 8px', background: '#050506', borderRight: '1px solid #18181b' },
  header: { left: 152, top: 0, width: 388, height: 34, borderBottom: '1px solid #18181b', background: '#0b0b0c' },
  worked: { left: 171, top: 66, width: 200, height: 12 },
  answer: { left: 171, top: 88, width: 345, height: 170, font: '400 7.5px/13px Inter', color: '#cfcfd3' },
  files: { left: 166, top: 268, width: 352, height: 24, borderRadius: 7, background: '#121214' },
  composer: { left: 166, top: 422, width: 360, height: 69.6, borderRadius: 9, background: '#121212', boxShadow: 'inset 0 0 0 1px #1c1c1c', zIndex: 1, fontSize: 8 },
  footer: { left: 166 + 22 * U, top: 422 + 69.6 - 6, width: 690 * U, height: 15.7 + 6, borderRadius: '0 0 8px 8px', background: '#151515', boxShadow: 'inset 0 0 0 1px #1c1c1c' },
  'diff-head': { left: 540, top: 0, width: 320, height: 86, borderRadius: '0 8px 0 0', background: '#0a0a0b', borderLeft: '1px solid #18181b' },
  ...Object.fromEntries(HUNKS.map(hunk => [hunk.part, { left: 540, top: hunk.top, width: 320, height: hunkHeight(hunk.rows), background: '#0a0a0b', borderLeft: '1px solid #18181b', font: '400 7.4px/12.2px ui-monospace,Menlo,monospace', color: '#d6d6d6', borderRadius: hunk.last ? '0 0 8px 0' : undefined }])),
};
type Part = keyof typeof PART;
type AppState = {
  /** Style per part on top of its layout; a part left out is not drawn. */
  parts: Partial<Record<Part, CSSProperties>>;
  worked?: string;
  /** 0..1 reveal per reply line. */
  reveal?: number[];
  merged?: boolean;
  prompt?: { text: string; caret: boolean; placeholder: boolean; send: number };
};

function T3App({ id, scale, state }: { id: string; scale: number; state: AppState }) {
  const { parts, prompt } = state;
  const part = (name: Part, children?: ReactNode) => parts[name] && <Box key={name} part={name} style={{ ...PART[name], ...parts[name] }}>{children}</Box>;
  const answer = answerLines(!!state.merged, index => ({ clipPath: `inset(0 ${(1 - (state.reveal?.[index] ?? 1)) * 100}% 0 0)` }));
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: APP.width, height: APP.height, zoom: scale, isolation: 'isolate', fontFamily: 'Inter,sans-serif', color: '#d6d6d6', WebkitFontSmoothing: 'antialiased' }}>
      {part('window')}
      {part('sidebar', <SidebarBody id={id} />)}
      {part('header', <HeaderBody />)}
      {part('worked', <At x={0} y={0} style={{ font: '400 7.5px Inter', color: MUTED }}>{state.worked ?? <>Worked for 3m 43s <span style={{ color: DIM }}>{'›'}</span></>}</At>)}
      {part('answer', answer)}
      {part('files', <FilesBody />)}
      {part('composer', <>
        <ComposerChrome />
        {(!prompt || prompt.placeholder) && <div style={{ ...promptText, color: '#6b6b6f' }}>Ask anything. @ files, $ skills, / commands</div>}
        {prompt && <div style={{ ...promptText, color: '#f3f3f3' }}>{prompt.text}<span style={{ display: 'inline-block', width: .6, height: 7.6, marginTop: -.35, verticalAlign: 'top', background: '#f3f3f3', opacity: prompt.caret ? 1 : 0 }} /></div>}
        <div style={{ position: 'absolute', left: 701 * U - 7.8, top: ROW - 7.8, width: 15.6, height: 15.6, borderRadius: '50%', background: '#3960e8', display: 'grid', placeItems: 'center', transform: `scale(${prompt?.send ?? 1})` }}><Icon name="arrow-up" size={7.4} color="#ffffff" strokeWidth={2.4} /></div>
      </>)}
      {part('footer', <FooterBody />)}
      {part('diff-head', <DiffHeadBody />)}
      {HUNKS.map(hunk => part(hunk.part, <HunkBody rows={hunk.rows} note={hunk.note} />))}
    </div>
  );
}

/** The app window on screen: 62% of the frame wide, centred, 23.5% down. */
function useWindow() {
  const { width, height } = useScene();
  const box = { left: (width - width * .62) / 2, top: height * .235, width: width * .62, height: APP.height * width * .62 / APP.width, scale: width * .62 / APP.width };
  /** The transform that puts app point (x, y) at screen point (sx, sy), magnified by `zoom`. */
  const focus = (x: number, y: number, zoom: number, sx: number, sy: number) => ({ zoom, x: sx - box.left - box.width / 2 - (x * box.scale - box.width / 2) * zoom, y: sy - box.top - box.height / 2 - (y * box.scale - box.height / 2) * zoom });
  return { box, focus };
}
type Camera = { zoom: number; x: number; y: number };
const between = (a: Camera, b: Camera, amount: number): Camera => ({ zoom: mix(a.zoom, b.zoom, amount), x: mix(a.x, b.x, amount), y: mix(a.y, b.y, amount) });
function Window({ id, camera, state }: { id: string; camera: Camera; state: AppState }) {
  const { box } = useWindow();
  return (
    <div style={{ position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height, transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})` }}>
      <T3App id={id} scale={box.scale} state={state} />
    </div>
  );
}

// ---------- Text on screen ----------

const captionStyle = (height: number): CSSProperties => ({ position: 'absolute', left: 0, right: 0, top: height * .1, textAlign: 'center', font: `500 ${height * .05}px/1.1 Outfit`, letterSpacing: -1, color: '#c9c9ce' });
/** A line that blooms in and blows out at `out` seconds on its beat's clock. */
function Caption({ text, out }: { text: string; out: number }) {
  const { height } = useScene(), { time } = useBeat();
  const enter = progress(time, 0, .9, 'expo.out'), exit = progress(time, out, .45, 'power2.in');
  const scale = exit > 0 ? mix(1, 1.04, exit) : mix(.94, 1, enter), blur = exit > 0 ? 10 * exit : 12 * (1 - enter);
  return <div style={{ ...captionStyle(height), opacity: enter * (1 - exit), transform: `scale(${scale})`, filter: `blur(${blur}px)` }}>{text}</div>;
}

// ---------- Beats ----------

/** The previous beat's title, "Meet T3 Code.", catches a shimmer and blows away. */
function Intro() {
  const { width } = useScene(), { time } = useBeat();
  const w = 760, h = 427.5, gone = progress(time, .2, .35, 'power2.in');
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, zoom: width / w, opacity: 1 - progress(time, .2, .4, 'power2.in'), background: 'radial-gradient(80% 90% at 50% 0%,#3b2a73,transparent 70%),radial-gradient(60% 70% at 100% 100%,#1d1640,transparent 70%),#08070d' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: h * .445, textAlign: 'center', font: `600 ${h * .11}px/1 Outfit`, color: '#fff', letterSpacing: -2, opacity: 1 - gone, transform: `scale(${1 + .04 * gone})`, filter: `blur(${10 * gone}px)` }}>
        Meet <Gradient>T3 Code.</Gradient>
        <div style={{ position: 'absolute', inset: 0, textAlign: 'center' }}>
          <span style={{ background: 'linear-gradient(100deg,transparent 35%,rgba(255,255,255,.95) 48%,rgba(214,194,255,.9) 52%,transparent 65%)', backgroundSize: '260% 100%', backgroundPosition: `${100 - 100 * progress(time, 0, .4, 'sine.inOut')}% 0`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Meet T3 Code.</span>
        </div>
      </div>
    </div>
  );
}

/** The headline rises, the dashboard builds piece by piece, then everything but the composer clears and the camera dives in. */
function Assembly() {
  const { width, height } = useScene(), { time } = useBeat(), { focus } = useWindow();
  const at = (start: number, duration = .5, curve = 'power3.out') => progress(time, start, duration, curve);
  const clear = 1 - at(2.45, .45, 'power2.in');
  const fade = (p: number, move: string) => ({ opacity: p * clear, transform: move });
  const items = (['worked', 'answer', 'files'] as const).map((name, index) => [name, at(1.45 + index * .1)] as const);
  const diff = (['diff-head', 'hunk-a', 'hunk-b', 'hunk-c'] as const).map((name, index) => [name, at(2.05 + index * .07)] as const);
  const sidebar = at(1, .55), header = at(1.25, .45), composer = at(1.8);
  const parts: AppState['parts'] = {
    window: { opacity: at(.85, .5, 'power2.out') * clear },
    sidebar: fade(sidebar, `translateX(${-30 * (1 - sidebar)}px)`),
    header: fade(header, `translateY(${-10 * (1 - header)}px)`),
    ...Object.fromEntries(items.map(([name, p]) => [name, fade(p, `translateY(${10 * (1 - p)}px)`)])),
    composer: { opacity: composer, transform: `translateY(${16 * (1 - composer)}px)` },
    footer: { opacity: composer, transform: `translateY(${16 * (1 - composer)}px)` },
    ...Object.fromEntries(diff.map(([name, p]) => [name, fade(p, `translateX(${30 * (1 - p)}px)`)])),
  };
  const shown = at(0, .5, 'power2.out'), rise = at(.45, .6, 'power3.inOut'), gone = at(2.35, .4, 'power2.in');
  return <>
    <Window id="a" camera={between({ zoom: 1, x: 0, y: 0 }, focus(346, 463, 1.75, width / 2, height * .56), at(2.35, .9, 'power3.inOut'))} state={{ parts }} />
    <div style={{ ...captionStyle(height), opacity: shown * (1 - gone), filter: `blur(${8 * (1 - shown) + 8 * gone}px)`, transform: `translateY(${(height / 2 - height * .1275) * (1 - rise)}px)` }}>First ADE made for developers.</div>
  </>;
}

const PROMPT = 'Keep settled responses visible';
/** When each character lands, at a human, slightly uneven pace. */
const KEYS = [...PROMPT].reduce<number[]>((times, char, index) => [...times, (times[index - 1] ?? .3) + (index ? .016 + PROMPT.charCodeAt(index - 1) * 37 % 7 * .003 + (PROMPT[index - 1] === ' ' ? .025 : 0) : 0)], []);
const SENT = KEYS[KEYS.length - 1] + .016 + PROMPT.charCodeAt(PROMPT.length - 1) * 37 % 7 * .003 + .08;
const WORKED = [0, 9, 21, 37, 58, 84, 113, 141, 168, 192, 211, 223];

/** The prompt is typed and sent, the camera pulls back to the reply, which streams in line by line. */
function Chat() {
  const { width, height } = useScene(), { time } = useBeat(), { focus } = useWindow();
  const typed = KEYS.filter(key => key <= time).length, cleared = time >= SENT + .15;
  const press = time < SENT ? 0 : time < SENT + .08 ? progress(time, SENT, .08, 'power2.inOut') : 1 - progress(time, SENT + .08, .08, 'power2.inOut');
  const reply = progress(time, 1.75, .4, 'power2.out'), files = progress(time, 3.68, .4, 'power2.out');
  const step = WORKED.filter((_, index) => time >= 1.9 + index * .14).pop();
  const state: AppState = {
    parts: { composer: {}, footer: {}, worked: { opacity: reply }, answer: { opacity: reply }, files: { opacity: files, transform: `translateY(${4 * (1 - files)}px)` } },
    worked: step === undefined ? undefined : `Worked for ${step < 60 ? `${step}s` : `${Math.floor(step / 60)}m ${step % 60}s`} ›`,
    reveal: Array.from({ length: ANSWER_COUNT }, (_, index) => progress(time, 2.2 + index * .12, .45, 'power2.out')),
    merged: true,
    prompt: { text: cleared ? '' : PROMPT.slice(0, typed), placeholder: time < .1 || cleared, caret: time >= .1 && !cleared && !(time >= .12 && time < .21), send: mix(1, .85, press) },
  };
  const camera = between(focus(346, 463, 1.75, width / 2, height * .56), focus(346, 282, 1.25, width / 2, height * .58), progress(time, 1.6, .9, 'power3.inOut'));
  return <Window id="b" camera={camera} state={state} />;
}

export default function T3CodeBeat() {
  return (
    <Layer style={{ background: 'radial-gradient(70% 60% at 50% 45%,#141019,#050507)', overflow: 'hidden' }}>
      <Beat id="intro" duration={.65}><Intro /></Beat>
      <Beat id="assembly" start={.5} duration={3.25}><Assembly /></Beat>
      <Beat id="chat" start="assembly" duration={4.4}>
        <Chat />
        <Beat start={1.75} track={1}><Caption text="Replies you'll actually enjoy reading." out={4.2} /></Beat>
      </Beat>
      <Beat start="assembly - 0.2" duration={2.15} track={1}><Caption text="Typing here feels like heaven." out={1.7} /></Beat>
    </Layer>
  );
}
