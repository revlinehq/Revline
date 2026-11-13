// Existing deployment settings remain valid while operators adopt neutral names.
const limits = [
  ['processor', 'MEDIA_PROCESSOR_MAX_WORKERS', 'FLY_PROCESSOR_MAX_MACHINES', 4, 1, 8],
  ['standard', 'EXPORT_MAX_WORKERS_STANDARD', 'FLY_RENDER_MAX_STANDARD', 10, 0, 100],
  ['ultra', 'EXPORT_MAX_WORKERS_ULTRA', 'FLY_RENDER_MAX_ULTRA', 10, 0, 100],
];

export function workerCapacity(env = process.env) {
  return Object.fromEntries(limits.map(([role, name, legacy, fallback, min, max]) => {
    const value = Number(env[name] ?? env[legacy] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
    return [role, value];
  }));
}

/** How many processor slots stay running while idle (MEDIA_PROCESSOR_ALWAYS_ON, default 0): the first that many of the
 *  manifest's processorServices never exit idle, and the dispatcher starts them whenever they are down. Other processor
 *  slots and every export slot still exit when idle. 0 turns it off. */
export function alwaysOnProcessors(env = process.env) {
  const value = Number(env.MEDIA_PROCESSOR_ALWAYS_ON ?? 0);
  if (!Number.isInteger(value) || value < 0 || value > 8) throw new Error('MEDIA_PROCESSOR_ALWAYS_ON must be a whole number from 0 to 8.');
  return Math.min(value, workerCapacity(env).processor);
}
