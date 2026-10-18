import { describe, expect, it } from 'vitest';
import { motionAt, NEUTRAL_MOTION, validateClipEffects, visibleMotion } from './clip-effects';
import { generateComposition } from './composition';
import { patchClip, setClipPlaybackRate, splitClip } from './operations';
import { resizeSelectedClips } from './timeline-controls';
import { smoothZoomFocus, smoothZoomPatch, zoomEase } from './smooth-zoom';
import type { SmoothZoomSettings } from './smooth-zoom-settings';
import type { Clip, MediaAsset, Timeline } from './types';

const asset: MediaAsset = { _id: 'source', kind: 'video', fileName: 'source.mp4', width: 1920, height: 1080, url: '/source.mp4' };
const clip: Clip = { id: 'video', kind: 'video', assetId: 'source', track: 1, start: 2, duration: 5, sourceStart: 10, playbackRate: 1, linkedClipId: 'audio', audioSeparated: true, volume: 0, fit: 'contain', crop: { left: .1, right: .05, top: 0, bottom: .1 }, transform: { x: .4, y: .6, scale: 1.1, rotation: 12, opacity: .8 } };
const settings: SmoothZoomSettings = { start: .5, inDuration: .6, holdDuration: 1, outDuration: .6, scale: 1.8, centerX: .75, centerY: .25, easing: 'ease-in-out' };
const audio: Clip = { id: 'audio', kind: 'audio', assetId: 'audio-source', start: 2, duration: 5, sourceStart: 10, linkedClipId: 'video', volume: .7 };
const timeline = (visual: Clip): Timeline => ({ fps: 30, aspectRatio: 'landscape', tracks: { visual: 1, audio: 1, overlay: 0 }, clips: [visual, audio] });
const authored = () => ({ ...clip, ...smoothZoomPatch(clip, asset, 'landscape', settings) });

describe('smooth zoom on the shared motion clock', () => {
  it('zooms in, holds, and returns without modifying framing, source timing or linked audio', () => {
    const before = structuredClone(clip), next = authored();
    expect(clip).toEqual(before);
    for (const key of ['fit', 'crop', 'transform', 'start', 'duration', 'sourceStart', 'playbackRate', 'linkedClipId', 'volume'] as const) expect(next[key]).toEqual(clip[key]);
    expect(() => validateClipEffects(next)).not.toThrow();
    expect(next.motion!.length).toBeLessThanOrEqual(120);
    for (const [time, scale] of [[0, 1], [.5, 1], [1.1, 1.8], [2.1, 1.8], [2.7, 1], [5, 1]]) expect(motionAt(next.motion!, time).scale).toBeCloseTo(scale, 8);
    const saved = patchClip(timeline(clip), clip.id, smoothZoomPatch(clip, asset, 'landscape', settings));
    expect(saved.clips[1]).toEqual(audio);
  });

  it('keeps zoomed framing through the end when return duration is zero', () => {
    const next = smoothZoomPatch(clip, asset, 'landscape', { ...settings, outDuration: 0, holdDuration: 200 });
    expect(motionAt(next.motion!, 4.9).scale).toBe(1.8);
    expect(next.motion!.at(-1)!.scale).toBe(1.8);
    expect(next.motion!.at(-1)!.time).toBe(5);
  });

  it('maps original-source coordinates through contain/crop and keeps the focus fixed under scaling', () => {
    const focus = smoothZoomFocus(clip, asset, 'vertical', settings);
    expect(focus.x).toBeCloseTo(.75);
    expect(focus.y).toBeCloseTo((656.25 + .25 * 607.5) / 1920);
    const next = { ...clip, ...smoothZoomPatch(clip, asset, 'vertical', settings) };
    const peak = motionAt(next.motion!, 1.1);
    expect((focus.x - .5) * peak.scale + .5 + peak.x).toBeCloseTo(focus.x);
    expect((focus.y - .5) * peak.scale + .5 + peak.y).toBeCloseTo(focus.y);
    // The existing rotation, opacity and outer transform remain authored independently.
    expect(next.transform).toEqual(clip.transform);
    expect(() => smoothZoomPatch(clip, asset, 'landscape', { ...settings, centerX: .02 })).toThrow('outside the visible crop');
  });

  it('never opens new gaps around a retained visible window when scaling up about a visible point', () => {
    const centered = { ...clip, transform: undefined };
    for (const centerX of [.1, .5, .9]) {
      const target = smoothZoomFocus(centered, asset, 'landscape', { centerX, centerY: .5 });
      const motion = smoothZoomPatch(centered, asset, 'landscape', { ...settings, centerX, centerY: .5 }).motion!;
      for (const key of motion) {
        const originalLeft = .1, originalRight = .95;
        const left = (originalLeft - .5) * key.scale + .5 + key.x;
        const right = (originalRight - .5) * key.scale + .5 + key.x;
        expect(left).toBeLessThanOrEqual(originalLeft + 1e-6);
        expect(right).toBeGreaterThanOrEqual(originalRight - 1e-6);
        expect(target.x).toBeGreaterThanOrEqual(originalLeft);
      }
    }
  });

  it('preserves phase through splits and trims and rescales the recipe with playback speed', () => {
    const next = authored(), source = timeline(next);
    const split = splitClip(source, 'video', 3.4, 'tail');
    const tail = split.clips.find(member => member.id === 'tail')!;
    expect(tail.smoothZoom).toEqual(settings);
    expect(visibleMotion(tail)[0].scale).toBeCloseTo(motionAt(next.motion!, 1.4).scale);
    const trimmed = resizeSelectedClips(source, [], ['video'], 'left', .4).clips.find(member => member.id === 'video')!;
    expect(trimmed.smoothZoom).toEqual(settings);
    expect(visibleMotion(trimmed)[0].scale).toBeCloseTo(motionAt(next.motion!, .4).scale);
    const fast = setClipPlaybackRate(source, 'video', 2), sped = fast.clips[0];
    expect(sped.smoothZoom).toEqual({ ...settings, start: .25, inDuration: .3, holdDuration: .5, outDuration: .3 });
    expect(motionAt(sped.motion!, .9).scale).toBeCloseTo(motionAt(next.motion!, 1.8).scale);
    expect(fast.clips[1]).toMatchObject({ sourceStart: 10, duration: 2.5, playbackRate: 2, volume: .7 });
  });

  it('rejects unrelated custom motion, moving tracked framing, unavailable dimensions and invalid timing', () => {
    const custom = { ...clip, motion: [{ time: 0, ...NEUTRAL_MOTION, rotation: 5 }] };
    expect(() => smoothZoomPatch(custom, asset, 'landscape', settings)).toThrow('already has custom motion');
    expect(() => smoothZoomPatch(custom, asset, 'landscape', settings, { replace: true })).not.toThrow();
    expect(() => smoothZoomPatch({ ...clip, focus: [{ time: 0, x: .3, y: .5 }, { time: 20, x: .6, y: .5 }] }, asset, 'landscape', settings)).toThrow('moving tracked framing');
    expect(() => smoothZoomPatch(clip, { ...asset, width: undefined }, 'landscape', settings)).toThrow('dimensions');
    expect(() => smoothZoomPatch({ ...clip, transform: { ...clip.transform!, x: 2 } }, asset, 'landscape', settings)).toThrow('outside the visible transformed frame');
    for (const changes of [{ scale: NaN }, { scale: 4 }, { centerX: -.1 }, { inDuration: 0 }, { outDuration: -1 }, { start: 4.5 }, { easing: 'arbitrary-script' as never }]) expect(() => smoothZoomPatch(clip, asset, 'landscape', { ...settings, ...changes })).toThrow();
  });

  it('invalidates recipe metadata when custom motion or source geometry is explicitly changed', () => {
    for (const changes of [{ motion: [{ time: 0, ...NEUTRAL_MOTION }] }, { fit: 'cover' as const }, { crop: undefined }, { focus: undefined }]) {
      const next = patchClip(timeline(authored()), 'video', changes).clips[0];
      expect(next.smoothZoom).toBeUndefined();
      expect(next.motion?.length).toBeGreaterThan(0);
    }
    expect(patchClip(timeline(authored()), 'video', { transform: { ...clip.transform!, rotation: 25 } }).clips[0].smoothZoom).toEqual(settings);
  });

  it('uses the existing deterministic composition tween path in preview and export', () => {
    const next = authored();
    const html = generateComposition({ ...timeline(next), clips: [next] }, [asset]);
    expect(html).toContain('data-media-start="10"');
    expect(html).toContain('rotate(12deg) scale(1.1)');
    expect(html).toContain('timeline.fromTo(\'#clip-0-motion\'');
    expect(html).toContain('"ease":"none"');
    expect(html).not.toContain('setInterval');
    expect(zoomEase(.25, 'ease-in-out')).toBeLessThan(.25);
    expect(zoomEase(.25, 'ease-out')).toBeGreaterThan(.25);
  });
});
