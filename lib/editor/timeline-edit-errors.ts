/** A rejected local gesture is a no-op, rather than an operational failure. */
export class TimelineGestureRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimelineGestureRejection';
  }
}

export function isTimelineGestureRejection(error: unknown): error is TimelineGestureRejection {
  return error instanceof TimelineGestureRejection;
}

/** Older clients can retain this obsolete gesture banner across a hot reload. */
export function isLegacyTimelineGestureMessage(message: string): boolean {
  return message === 'Clip timing must have a positive duration and a valid source offset.';
}
