/** Unconfigured deployments keep their existing consumer until a verified Fly rollout. */
export function processorBackend(): 'fly' | 'cloudflare' | 'local' {
  const backend = process.env.MEDIA_PROCESSOR_BACKEND;
  if (backend === 'fly' || backend === 'cloudflare' || backend === 'local') return backend;
  if (backend) throw new Error('MEDIA_PROCESSOR_BACKEND must be fly, cloudflare or local.');
  return process.env.MEDIA_PROCESSOR_WAKE_URL ? 'cloudflare' : 'local';
}
