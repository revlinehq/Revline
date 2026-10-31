/** A rejected local gesture is a no-op, rather than an operational failure. */
export class TimelineGestureRejection extends Error {
  constructor(message: string, readonly code?: 'overlap' | 'approved') {
    super(message);
    this.name = 'TimelineGestureRejection';
  }
}

export function isOverlapPlacementRejection(error: unknown): error is TimelineGestureRejection {
  return error instanceof TimelineGestureRejection && error.code === 'overlap';
}

/** An edit refused before it changed anything because it touches approved work. */
export function isApprovalRejection(error: unknown): error is TimelineGestureRejection {
  return error instanceof TimelineGestureRejection && error.code === 'approved';
}

export function isTimelineGestureRejection(error: unknown): error is TimelineGestureRejection {
  return error instanceof TimelineGestureRejection;
}

/** Older clients can retain this obsolete gesture banner across a hot reload. */
export function isLegacyTimelineGestureMessage(message: string): boolean {
  return message === 'Clip timing must have a positive duration and a valid source offset.';
}
