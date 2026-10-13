export const TIMELINE_BASE_PX = 54;
export const TIMELINE_MAX_ZOOM = 4;
export const TIMELINE_OVERVIEW_SECONDS = 4 * 60 * 60;

export function minimumTimelineZoom(viewportWidth: number) {
  return Math.max(720, viewportWidth) / (TIMELINE_BASE_PX * TIMELINE_OVERVIEW_SECONDS);
}

// A logarithmic slider gives detailed cuts and hour-long overviews usable room.
export function timelineZoomPosition(zoom: number, minimum: number) {
  return Math.max(0, Math.min(100, 100 * Math.log(zoom / minimum) / Math.log(TIMELINE_MAX_ZOOM / minimum)));
}

export function timelineZoomAtPosition(position: number, minimum: number) {
  if(position>=100)return TIMELINE_MAX_ZOOM;
  if(position<=0)return minimum;
  return minimum * Math.pow(TIMELINE_MAX_ZOOM / minimum, Math.max(0, Math.min(100, position)) / 100);
}
