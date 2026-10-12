import { expect, it } from 'vitest';
import { formatRulerLabel } from './timeline-ruler';

it('labels seconds, subsecond positions, and minute boundaries with explicit units',()=>{
 expect(formatRulerLabel(0)).toBe('0s');
 expect(formatRulerLabel(2)).toBe('2s');
 expect(formatRulerLabel(1.5)).toBe('1.5s');
 expect(formatRulerLabel(60)).toBe('1m 00s');
 expect(formatRulerLabel(125)).toBe('2m 05s');
 expect(formatRulerLabel(61.5)).toBe('1m 01.5s');
});
