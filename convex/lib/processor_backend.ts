/** Unconfigured deployments retain Cloudflare or local processing. */
export function processorBackend(): 'railway' | 'cloudflare' | 'local' {
  const backend = process.env.MEDIA_PROCESSOR_BACKEND;
  if (backend === 'railway' || backend === 'cloudflare' || backend === 'local') return backend;
  if (backend) throw new Error('MEDIA_PROCESSOR_BACKEND must be railway, cloudflare or local.');
  return process.env.MEDIA_PROCESSOR_WAKE_URL ? 'cloudflare' : 'local';
}
