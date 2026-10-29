// Beat clip "T3 Code: chat" (3.75 to 8.15 s). It opens on the composer, already framed by the
// "Zoom into composer" transition: the prompt is typed and sent, the camera pulls back to the reply,
// which streams in line by line.
import { Beat, Layer, mix, progress, useBeat, useScene } from 'revline';
import { Caption, ANSWER_COUNT, Window, between, useWindow, type AppState } from 'blueprint:T3 Code';

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

export default function ChatBeat() {
  return (
    <Layer style={{ background: 'radial-gradient(70% 60% at 50% 45%,#141019,#050507)', overflow: 'hidden' }}>
      <Chat />
      <Beat duration={1.95} track={1}><Caption text="Typing here feels like heaven." out={1.5} /></Beat>
      <Beat start={1.75} track={1}><Caption text="Replies you'll actually enjoy reading." out={4.2} /></Beat>
    </Layer>
  );
}
