import { skillText, skillDocument } from './documents';
import { SOUND_EFFECT_LIMITS } from '../../audio/sound-effect';
import { STOCK_AUDIO_CATALOG } from '../../editor/stock-audio';
import { MIXKIT_LICENSE, STOCK_MUSIC_CATALOG } from '../../editor/stock-music';
import type { EditorSkill } from './types';

const library = STOCK_AUDIO_CATALOG.map(sound => `- \`${sound.id}\` (${sound.category}): ${sound.name}, ${sound.duration.toFixed(2)} s [${sound.tags.join(' ')}]`).join('\n');

const musicLibrary = STOCK_MUSIC_CATALOG.map(track => `- \`${track.id}\`: ${track.title}, ${track.artist} (${track.genre}, ${track.bpm} BPM, ${Math.round(track.duration)} s) [${track.tags.slice(0, 5).join(' ')}]`).join('\n');

export const musicAndSound: EditorSkill = {
  name: skillDocument("music-and-sound/SKILL.md").name,
  description: skillDocument("music-and-sound/SKILL.md").description,
  body: skillText("music-and-sound/SKILL.md", [SOUND_EFFECT_LIMITS.minDuration, SOUND_EFFECT_LIMITS.maxDuration, library, MIXKIT_LICENSE.name, musicLibrary]),
};
