import { expect, it } from 'vitest';
import { minimumTimelineZoom, timelineZoomPosition, timelineZoomAtPosition, TIMELINE_BASE_PX, TIMELINE_MAX_ZOOM } from './timeline-zoom';

it('fits four hours at minimum zoom across desktop viewport sizes', () => {
  for (const width of [720, 1000, 1800]) {
    const minimum = minimumTimelineZoom(width);
    expect(width / (TIMELINE_BASE_PX * minimum)).toBeCloseTo(14400);
    for (const zoom of [minimum, .15, 1, TIMELINE_MAX_ZOOM]) {
      expect(timelineZoomAtPosition(timelineZoomPosition(zoom, minimum), minimum)).toBeCloseTo(zoom);
    }
  }
});
