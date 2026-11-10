const DAY = 86400_000;
const clock = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
/** Whole calendar days from today to `time`, in the viewer's time zone: 1 is tomorrow, -2 is the day before yesterday. */
function daysFromToday(time: number, now: number) {
  const day = new Date(time), today = new Date(now);
  day.setHours(0, 0, 0, 0); today.setHours(0, 0, 0, 0);
  return Math.round((day.getTime() - today.getTime()) / DAY);
}

/** When a post goes out or went out, the way people say it: "Today 6:00 PM", "Thursday 6:00 PM", "2 days ago", "Nov 3". */
export function postTime(time: number, now = Date.now()) {
  const days = daysFromToday(time, now);
  if (days === 0) return `Today ${clock(time)}`;
  if (days === 1) return `Tomorrow ${clock(time)}`;
  if (days === -1) return `Yesterday ${clock(time)}`;
  if (days > 1 && days < 7) return `${new Date(time).toLocaleDateString(undefined, { weekday: 'long' })} ${clock(time)}`;
  if (days < -1 && days > -7) return `${-days} days ago`;
  const date = new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(new Date(time).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
  return days > 0 ? `${date} ${clock(time)}` : date;
}
