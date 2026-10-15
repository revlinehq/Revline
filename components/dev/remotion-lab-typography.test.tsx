import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_LAB_CONFIG, labTemplateFile, parseLabFile } from './remotion-lab-model';
import { LAB_EXTRA_TEXT_PRESETS, LAB_TEXT_PRESETS } from './remotion-lab-text-presets';
import { RemotionLabTypography } from './remotion-lab-typography';

describe('lab-only typography treatments', () => {
  for (const preset of LAB_EXTRA_TEXT_PRESETS) {
    it(`${preset} renders from frames deterministically with editable text and strength`, () => {
      const config = { ...DEFAULT_LAB_CONFIG, textPreset: preset, title: 'Make every word count.' };
      const render = (frame: number, strength = 1) => renderToStaticMarkup(<RemotionLabTypography preset={preset} config={{ ...config, textStrength: strength }} frame={frame}/>);
      const entrance = render(5);
      expect(render(90)).not.toEqual(entrance);
      render(150); render(0);
      expect(render(5)).toEqual(entrance);
      expect(render(5, .2)).not.toEqual(render(5, 2));
      expect(entrance).toContain('aria-label="Make every word count."');
      expect(entrance).toContain(`data-lab-text="${preset}"`);
      expect(entrance).not.toMatch(/animation:|transition:|NaN|Infinity/);
      expect(parseLabFile(labTemplateFile(config))).toEqual(config);
    });
  }

  it('preserves the original seven presets and upgrades older saved lab designs', () => {
    expect(LAB_TEXT_PRESETS).toHaveLength(24);
    expect(new Set(LAB_TEXT_PRESETS).size).toEqual(24);
    const { textStrength: _strength, textStagger: _stagger, textDepthStyle: _depthStyle, textDepth: _depth, textTiltX: _tiltX, textTiltY: _tiltY, ...legacy } = DEFAULT_LAB_CONFIG;
    expect(parseLabFile({ type: 'revline-remotion-template', version: 1, config: legacy })).toEqual(DEFAULT_LAB_CONFIG);
  });

  it('keeps the template boundary safe when importing new controls', () => {
    for (const patch of [{ textStrength: -1 }, { textStrength: Infinity }, { textStagger: .5 }, { textPreset: 'unrecognized-style' }]) {
      expect(() => parseLabFile(labTemplateFile({ ...DEFAULT_LAB_CONFIG, ...patch } as typeof DEFAULT_LAB_CONFIG))).toThrow();
    }
  });
});
