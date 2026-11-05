/** A short running length such as 3:07, rounded to whole seconds. */
export function minutesSeconds(seconds: number) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
