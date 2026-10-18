import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type OpenAiCostReport = {
  connected: true;
  projectId: string;
  days: 7 | 30;
  start: number;
  end: number;
  refreshedAt: number;
  totalUsd: number;
  daily: { date: string; usd: number }[];
};
type Connection = { adminKey: string; projectId: string; ownerId: string; updatedAt: number };
type CostPage = { data?: { start_time: number; end_time: number; results?: { project_id?: string | null; amount?: { value?: number; currency?: string } }[] }[]; has_more?: boolean; next_page?: string | null };
const day = 86_400;
export class OpenAiCostsError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export function parseConnectionInput(value: unknown) {
  const body = value as Record<string, unknown> | null;
  if (!body || typeof body.adminKey !== 'string' || !/^sk-admin-[A-Za-z0-9_-]{10,500}$/.test(body.adminKey.trim())) throw new OpenAiCostsError('Enter an OpenAI Admin API key with Usage read access.', 400);
  if (typeof body.projectId !== 'string' || !/^proj_[A-Za-z0-9_-]{5,100}$/.test(body.projectId.trim())) throw new OpenAiCostsError('Enter the Revline API project ID.', 400);
  return { adminKey: body.adminKey.trim(), projectId: body.projectId.trim() };
}

// Server routes import this module; neither the credential nor upstream errors are returned to clients.
export function createOpenAiCostsStore({ directory = join(process.cwd(), '.data', 'openai-costs'), fetcher = fetch, now = Date.now }: { directory?: string; fetcher?: typeof fetch; now?: () => number } = {}) {
  const cache = new Map<string, OpenAiCostReport>();
  const path = join(directory, 'connection.json');
  async function readConnection(ownerId: string): Promise<Connection | null> {
    try {
      const raw = JSON.parse(await readFile(path, 'utf8')) as Connection;
      if (raw.ownerId !== ownerId) return null;
      const credentials = parseConnectionInput(raw);
      return { ...credentials, ownerId, updatedAt: raw.updatedAt };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new OpenAiCostsError('The local costs connection could not be read. Reconnect it.', 503);
    }
  }
  async function fetchCosts(connection: Pick<Connection, 'adminKey' | 'projectId'>, days: number) {
    const end = Math.floor(now() / 1000);
    const start = Math.floor(end / day) * day - (days - 1) * day;
    const totals = new Map<string, number>();
    for (let i = 0; i < days; i++) totals.set(new Date((start + i * day) * 1000).toISOString().slice(0, 10), 0);
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 4; page++) {
      const url = new URL('https://api.openai.com/v1/organization/costs');
      url.searchParams.set('start_time', String(start));
      url.searchParams.set('end_time', String(Math.max(end, start + 1)));
      url.searchParams.set('bucket_width', '1d');
      url.searchParams.set('limit', String(days));
      url.searchParams.append('project_ids', connection.projectId);
      url.searchParams.append('group_by', 'project_id');
      if (cursor) url.searchParams.set('page', cursor);
      let response: Response;
      try {
        response = await fetcher(url, { headers: { Authorization: `Bearer ${connection.adminKey}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
      } catch { throw new OpenAiCostsError('OpenAI costs could not be reached. Try refreshing shortly.'); }
      if (!response.ok) {
        await response.body?.cancel();
        throw new OpenAiCostsError(response.status === 401 || response.status === 403 ? 'OpenAI rejected the costs key. Check its Usage read permission and organization.' : response.status === 429 ? 'OpenAI costs are rate limited. Try refreshing shortly.' : 'OpenAI could not return costs for this project.', response.status === 401 || response.status === 403 ? 400 : 502);
      }
      let data: CostPage;
      try { data = await response.json() as CostPage; } catch { throw new OpenAiCostsError('OpenAI returned an unreadable costs report.'); }
      if (!Array.isArray(data.data) || data.data.length > 31) throw new OpenAiCostsError('OpenAI returned an unexpected costs report.');
      for (const bucket of data.data) {
        if (!Number.isFinite(bucket.start_time) || bucket.start_time < start || bucket.start_time >= Math.max(end, start + 1) || !Array.isArray(bucket.results)) throw new OpenAiCostsError('OpenAI returned an unexpected costs bucket.');
        const date = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
        if (seen.has(date)) throw new OpenAiCostsError('OpenAI returned duplicate costs buckets.');
        seen.add(date);
        for (const row of bucket.results) {
          if (row.project_id !== connection.projectId || row.amount?.currency?.toLowerCase() !== 'usd' || typeof row.amount.value !== 'number' || !Number.isFinite(row.amount.value)) throw new OpenAiCostsError('OpenAI returned costs outside the selected project or currency.');
          totals.set(date, (totals.get(date) ?? 0) + row.amount.value);
        }
      }
      if (!data.has_more) return { start: start * 1000, end: end * 1000, daily: [...totals].map(([date, usd]) => ({ date, usd })), totalUsd: [...totals.values()].reduce((a, b) => a + b, 0) };
      if (!data.next_page || cursor === data.next_page) throw new OpenAiCostsError('OpenAI returned an incomplete costs report.');
      cursor = data.next_page;
    }
    throw new OpenAiCostsError('OpenAI costs exceeded the report page limit. Try again shortly.');
  }
  return {
    async connect(ownerId: string, value: unknown) {
      const credentials = parseConnectionInput(value);
      await fetchCosts(credentials, 1);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const connection: Connection = { ...credentials, ownerId, updatedAt: now() };
      const temporary = join(directory, `connection-${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(connection), { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
      await chmod(path, 0o600);
      cache.clear();
      return { connected: true as const, projectId: connection.projectId };
    },
    async report(ownerId: string, days: 7 | 30): Promise<OpenAiCostReport | { connected: false }> {
      const connection = await readConnection(ownerId);
      if (!connection) return { connected: false };
      const key = `${ownerId}:${connection.projectId}:${connection.updatedAt}:${days}`;
      const existing = cache.get(key);
      if (existing && now() - existing.refreshedAt < 60_000 && new Date(existing.end).toISOString().slice(0, 10) === new Date(now()).toISOString().slice(0, 10)) return existing;
      const costs = await fetchCosts(connection, days);
      const report: OpenAiCostReport = { connected: true, projectId: connection.projectId, days, refreshedAt: now(), ...costs };
      cache.set(key, report);
      return report;
    },
  };
}
export const openAiCosts = createOpenAiCostsStore();
