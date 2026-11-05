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
