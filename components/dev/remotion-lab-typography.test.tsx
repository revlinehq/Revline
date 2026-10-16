import { describe, expect, it } from 'vitest';
import { DEFAULT_LAB_CONFIG, labTemplateFile, parseLabFile } from './remotion-lab-model';

describe('lab-only typography treatments', () => {
  it('upgrades older saved lab designs', () => {
    const { textStrength: _strength, textStagger: _stagger, textDepthStyle: _depthStyle, textDepth: _depth, textTiltX: _tiltX, textTiltY: _tiltY, ...legacy } = DEFAULT_LAB_CONFIG;
    expect(parseLabFile({ type: 'revline-remotion-template', version: 1, config: legacy })).toEqual(DEFAULT_LAB_CONFIG);
  });

  it('keeps the template boundary safe when importing new controls', () => {
    for (const patch of [{ textStrength: -1 }, { textStrength: Infinity }, { textStagger: .5 }, { textPreset: 'unrecognized-style' }]) {
      expect(() => parseLabFile(labTemplateFile({ ...DEFAULT_LAB_CONFIG, ...patch } as typeof DEFAULT_LAB_CONFIG))).toThrow();
    }
  });
});
