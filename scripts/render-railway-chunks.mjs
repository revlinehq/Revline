import { randomUUID } from 'node:crypto';
import { railwayConfig, verifyRailwayTarget, createRailwayService, configureRailwaySlot, deployRailwaySlot, railwayInstance, railwayActive, deleteRailwayService, RAILWAY_CPU_ENV } from '../lib/railway-workers.mjs';

const target = () => ({ token: process.env.RAILWAY_API_TOKEN, config: railwayConfig(process.env.RAILWAY_WORKERS_JSON) });

export async function launchRailwayChunk({ index, planKey, outKey, quality, chunkGuest, chunkEnv }) {
  if (chunkGuest.cpus !== 4 || chunkGuest.memory_mb !== 8192) throw new Error('Railway chunks use exactly 4 CPUs / 8192 MiB.');
  const selected = target();
  await verifyRailwayTarget(selected);
  const name = `render-${{ production: 'p', staging: 's', dev: 'd' }[selected.config.environment]}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const serviceId = await createRailwayService({ ...selected, name });
  try {
    await configureRailwaySlot({ ...selected, serviceId, image: selected.config.exportsImage, variables: {
      ...chunkEnv, ...RAILWAY_CPU_ENV, PRODUCER_FORCE_SCREENSHOT: 'false',
      NEXT_PUBLIC_CONVEX_URL: selected.config.convexUrl, RAILWAY_WORKERS_JSON: JSON.stringify(selected.config),
      REVLINE_RAILWAY_IMAGE: selected.config.exportsImage, MEDIA_WORKER_CONCURRENCY: '1',
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_ENDPOINT_URL_S3: process.env.AWS_ENDPOINT_URL_S3, BUCKET_NAME: process.env.BUCKET_NAME,
      ...(process.env.AWS_REGION ? { AWS_REGION: process.env.AWS_REGION } : {}),
      REVLINE_CHUNK_PLAN_KEY: planKey, REVLINE_CHUNK_INDEX: String(index), REVLINE_CHUNK_OUT_KEY: outKey, REVLINE_CHUNK_QUALITY: quality,
    } });
    await deployRailwaySlot({ ...selected, serviceId });
    return serviceId;
  } catch (error) {
    await deleteRailwayService({ ...selected, serviceId }).catch(() => {});
    throw error;
  }
}
export async function railwayChunkRunning(serviceId) { return railwayActive(await railwayInstance({ ...target(), serviceId })); }
export async function removeRailwayChunk(serviceId) { await deleteRailwayService({ ...target(), serviceId }); }
