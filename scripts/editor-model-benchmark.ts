/** Real editor 1v1. Dry-run is the default; --run permits paid model calls.
 * See scripts/editor-benchmark/README.md for the private fixture schema.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import type { Doc, Id } from '../convex/_generated/dataModel';
import type { Timeline } from '../lib/editor/types';
import { BENCHMARK_MODELS, BenchmarkGuardError, CostLedger, casePrompt, initialTimeline, scoreTimeline, summarizeUsage, type BenchmarkModel, type CaseName, type StoredMessage, type Transcript } from './editor-benchmark/scoring';

type Fixture = {
  version: 1; target: 'production' | 'development'; convexUrl: string; deploymentName: string; ownerId: string;
  projectTitlePrefix: string; allowedSourceProjectIds: string[]; sources: { cutsAssetId: string; speechAssetId: string };
  auth: { clerkSessionId?: string; clerkAppId?: string; clerkInstance?: 'prod' | 'dev'; clerkSecretEnv?: string; convexTokenFile?: string };
  usageEnvFile: string; models: BenchmarkModel[]; maxModelCostUsd: number; perRunReserveUsd: number;
  deadlineSeconds: number; renderDeadlineSeconds: number;
  analysisPreparation: { usd: number | null; note: string };
};
type Asset = Doc<'assets'> & { url: string | null };
type EvidenceFile = { path: string; sha256: string };
type HistoricalCostReceipt = {
  version: 1; kind: 'benchmark-local-preflight-reconciliation'; target: Fixture['target']; convexUrl: string; ownerId: string;
  sources: Fixture['sources']; knownModelCostUsd: number; unresolvedProviderCostUsd: number;
  files: { fixture: EvidenceFile; manifest: EvidenceFile; messages: EvidenceFile; sources: EvidenceFile; plan: EvidenceFile; deployedTokenBudget: EvidenceFile; deployedAssistantActions: EvidenceFile };
  attempt: { case: CaseName; model: BenchmarkModel; inputSha256: string; completedProviderMessageIds: string[]; localOnlyMessageIds: string[] };
  proof: { classification: 'local-preflight-before-provider-generation'; deployedCommit: string; localFailureMessageId: string; localFailureError: string; localPreflightProven: boolean };
};
const cases: CaseName[] = ['precise-cuts', 'subtitles', 'styled-edit'];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let stage = 'arguments', stopRequested = false;
let active: { client: () => Promise<ConvexHttpClient>; projectId: Id<'projects'> } | undefined;
class BenchmarkError extends Error {}
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new BenchmarkError(message); }
function commandJson<T>(binary: string, args: string[]): T {
  // CLI errors contain argv, including Clerk's explicit secret. Keep all child
  // output private and replace errors with a fixed stage-aware message.
  try { return JSON.parse(execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 45_000, maxBuffer: 24 * 1024 * 1024 })) as T; }
  catch { throw new BenchmarkError('Private CLI request failed; no command arguments or provider output were logged.'); }
}
export function verifyBenchmarkTokenBudget(fixture: Pick<Fixture, 'deploymentName' | 'usageEnvFile'>, readValue = (args: string[]) => execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 45_000, maxBuffer: 1024 * 1024 })) {
  let value: string;
  try { value = readValue([join(process.cwd(), 'node_modules/convex/bin/main.js'), 'env', 'get', 'EDITOR_ENFORCE_TOKEN_BUDGET', '--deployment', fixture.deploymentName, '--env-file', fixture.usageEnvFile]).replace(/\r?\n$/, ''); }
  catch { throw new BenchmarkError('Cannot verify the target backend token-budget flag. Paid benchmarks require EDITOR_ENFORCE_TOKEN_BUDGET=true; no further benchmark projects or paid edits will be started.'); }
  requireValue(value === 'true', 'Paid benchmarks require EDITOR_ENFORCE_TOKEN_BUDGET=true on the target backend. Normal editor budgets are off by default; this runner never changes environment variables.');
}
function jwtClaims(jwt: string) {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as { sub?: string; exp?: number }; }
  catch { throw new BenchmarkError('The private authentication token is malformed.'); }
}
async function privateJson<T>(path: string): Promise<T> {
  requireValue(isAbsolute(path), 'Private fixture and token paths must be absolute.');
  const metadata = await stat(path);
  requireValue((metadata.mode & 0o077) === 0, 'Private fixture/token files must have mode 600 or stricter.');
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
async function main() {
  const { values } = parseArgs({ options: { target: { type: 'string' }, fixture: { type: 'string' }, output: { type: 'string' }, run: { type: 'boolean', default: false }, 'prior-known-model-cost-usd': { type: 'string' }, 'reconciliation-receipt': { type: 'string' } }, strict: true });
  requireValue(values.target === 'production' || values.target === 'development', 'Pass --target production or --target development explicitly.');
  requireValue(values.fixture && values.output, 'Pass --fixture and --output explicitly.');
  const fixture = await privateJson<Fixture>(resolve(values.fixture));
  requireValue(fixture.version === 1 && fixture.target === values.target, 'Fixture target must match the explicit CLI target.');
  requireValue(/^[a-z][a-z0-9-]+$/.test(fixture.deploymentName), 'Fixture deployment name is invalid.');
  requireValue(fixture.convexUrl === `https://${fixture.deploymentName}.convex.cloud`, 'Fixture URL must match its explicit Convex deployment name.');
  requireValue(fixture.ownerId?.startsWith('user_') && fixture.allowedSourceProjectIds?.length > 0, 'A disposable owner and source-project allowlist are required.');
  requireValue(/^MVP QA [a-zA-Z0-9-]+ $/.test(fixture.projectTitlePrefix), 'Use the disposable fixture nonce title prefix: MVP QA <nonce> followed by one space.');
  requireValue(fixture.models?.length === 2 && BENCHMARK_MODELS.every(model => fixture.models.includes(model)), 'Select exactly claude-sonnet-5-5 and gpt-6.1-sol.');
  requireValue(fixture.sources?.cutsAssetId && fixture.sources.speechAssetId, 'Both source asset IDs are required.');
  requireValue(isAbsolute(fixture.usageEnvFile), 'An explicit absolute usage environment file is required.');
  requireValue(fixture.deadlineSeconds >= 30 && fixture.deadlineSeconds <= 600 && fixture.renderDeadlineSeconds >= 30 && fixture.renderDeadlineSeconds <= 1200, 'Editing and render deadlines must be bounded (30–600 and 30–1200 seconds).');
  requireValue(fixture.analysisPreparation && (fixture.analysisPreparation.usd === null || fixture.analysisPreparation.usd >= 0), 'Record shared analysis preparation costs separately, using null when unmetered.');
  const priorCostInput = values['prior-known-model-cost-usd'], receiptInput = values['reconciliation-receipt'];
  requireValue(Boolean(priorCostInput) === Boolean(receiptInput), 'Prior known model cost and its reviewed reconciliation receipt must be supplied together.');
  requireValue(priorCostInput === undefined || /^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/.test(priorCostInput), 'Prior known model cost must be an explicit nonnegative decimal USD amount.');
  const priorKnownCostUsd = priorCostInput === undefined ? 0 : Number(priorCostInput);
  let history: HistoricalCostReceipt | undefined;
  if (receiptInput) {
    history = await privateJson<HistoricalCostReceipt>(resolve(receiptInput));
    requireValue(history.version === 1 && history.kind === 'benchmark-local-preflight-reconciliation' && history.proof?.classification === 'local-preflight-before-provider-generation' && history.proof.localPreflightProven === true && /^[a-f0-9]{40}$/.test(history.proof.deployedCommit), 'Historical cost requires a reviewed, source-bound local-preflight receipt.');
    requireValue(history.target === fixture.target && history.convexUrl === fixture.convexUrl && history.ownerId === fixture.ownerId && digest(history.sources) === digest(fixture.sources), 'Historical receipt target, owner and sources must match the unchanged fixture.');
    requireValue(history.unresolvedProviderCostUsd === 0 && Number.isFinite(history.knownModelCostUsd) && Math.abs(history.knownModelCostUsd - priorKnownCostUsd) < 1e-10, 'Historical cost must match its receipt and contain no unresolved provider charge.');
    for (const file of Object.values(history.files)) {
      requireValue(isAbsolute(file.path) && /^[a-f0-9]{64}$/.test(file.sha256), 'Historical evidence requires absolute paths and SHA-256 hashes.');
      requireValue(createHash('sha256').update(await readFile(file.path)).digest('hex') === file.sha256, 'Historical evidence changed after reconciliation. Keep the original manifest and reservation intact.');
    }
    requireValue(createHash('sha256').update(await readFile(resolve(values.fixture))).digest('hex') === history.files.fixture.sha256, 'A controlled rerun must use the unchanged original fixture.');
    const captured = await privateJson<{ isDone: boolean; page: StoredMessage[] }>(history.files.messages.path);
    requireValue(captured.isDone === true && Array.isArray(captured.page), 'Historical messages must be a complete captured page.');
    const providerIds = new Set(history.attempt.completedProviderMessageIds), localIds = new Set(history.attempt.localOnlyMessageIds);
    requireValue(providerIds.size > 0 && providerIds.size === history.attempt.completedProviderMessageIds.length && localIds.size === history.attempt.localOnlyMessageIds.length && [...providerIds].every(id => !localIds.has(id)), 'Historical provider and local row IDs must be explicit and distinct.');
    const assistantRows = captured.page.filter(message => message.message?.role === 'assistant');
    requireValue(assistantRows.every(message => providerIds.has(message._id) || localIds.has(message._id)) && assistantRows.length === providerIds.size + localIds.size, 'Every historical assistant row must be accounted for by the reviewed receipt.');
    const completed = assistantRows.filter(message => providerIds.has(message._id));
    requireValue(completed.every(message => message.status === 'success'), 'Historical provider calls must have completed successfully.');
    requireValue(Math.abs(summarizeUsage(completed, history.attempt.model).usd - priorKnownCostUsd) < 1e-10, 'Historical cost does not match complete preceding provider usage.');
    requireValue(assistantRows.filter(message => localIds.has(message._id)).every(message => !message.model && !message.provider && !message.usage), 'Only specifically reviewed local preflight rows may be reconciled outside provider usage.');
    const failed = captured.page.find(message => message._id === history!.proof.localFailureMessageId) as (StoredMessage & { error?: string }) | undefined;
    requireValue(failed?.status === 'failed' && localIds.has(failed._id) && failed.error === history.proof.localFailureError, 'The historical local failure must match its exact persisted source error.');
  }
  const ledger = new CostLedger(fixture.maxModelCostUsd, fixture.perRunReserveUsd, priorKnownCostUsd);
  if (values.run) {
    requireValue(!process.env.CONVEX_DEPLOYMENT || process.env.CONVEX_DEPLOYMENT === `${fixture.target === 'production' ? 'prod' : 'dev'}:${fixture.deploymentName}`, 'Current Convex environment conflicts with the fixture target.');
    requireValue(!process.env.NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL === fixture.convexUrl, 'Current public Convex URL conflicts with the fixture target.');
    stage = 'server budget preflight';
    verifyBenchmarkTokenBudget(fixture);
  }
  const output = resolve(values.output);
  await mkdir(output, { recursive: true, mode: 0o700 }); await chmod(output, 0o700);
  if (values.run) {
    const existingResults = await stat(join(output, 'results.json')).then(() => true, () => false);
    requireValue(!existingResults, 'This output already contains benchmark results. Preserve its usage ledger and use a new reviewed run directory.');
    try { await writeFile(join(output, '.benchmark-run-lock'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' }); }
    catch { throw new BenchmarkError('This output already has a benchmark run lock. Inspect the prior run and usage ledger before restarting.'); }
  }
  const save = (name: string, value: unknown) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const plan = { version: 1, target: fixture.target, deploymentName: fixture.deploymentName, models: fixture.models, serial: true, cases: cases.map(name => ({ name, prompt: casePrompt(name, 12) })), cost: { maxModelCostUsd: fixture.maxModelCostUsd, perRunReserveUsd: fixture.perRunReserveUsd, priorKnownCostUsd, reconciliationReceiptSha256: history ? createHash('sha256').update(await readFile(resolve(receiptInput!))).digest('hex') : null, backendTokenBudget: { flag: 'EDITOR_ENFORCE_TOKEN_BUDGET', requiredValue: 'true', verified: values.run }, conservativeInputUnitsPerRun: 300_000, rawInputTokensPerRun: 1_000_000, inputUnitWeights: { uncached: 1, cacheWrite: 1.25, nativeCacheRead: 0.25 }, nativePromptCacheTtl: { 'claude-sonnet-5-5': '5m', 'gpt-6.1-sol': '30m' }, outputTokensPerRun: 12_000, usdPerMillion: { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 }, pricingReviewedOn: '2026-10-15', pricingSources: ['https://platform.claude.com/docs/en/about-claude/pricing', 'https://developers.openai.com/api/docs/models/gpt-6.1-sol'], note: 'Model cost estimates from persisted provider usage; preparation/analysis and hosted render costs are separate. The per-run reservation is a spending guard, not a provider billing cap.' }, analysisPreparation: fixture.analysisPreparation };
  if (history) {
    const originalPlan = await privateJson<{ cases: typeof plan.cases; models: BenchmarkModel[] }>(history.files.plan.path);
    requireValue(digest(originalPlan.cases) === digest(plan.cases) && digest(originalPlan.models) === digest(plan.models), 'Controlled rerun prompts, cases and model order must match the original inputs.');
  }
  await save('plan.json', plan);
  console.log(JSON.stringify({ mode: values.run ? 'run' : 'dry-run', target: fixture.target, models: fixture.models, cases, maxModelCostUsd: ledger.ceilingUsd, priorKnownCostUsd: ledger.priorKnownCostUsd, perRunReserveUsd: ledger.perRunReserveUsd, output }));
  if (!values.run) return;
  stage = 'authentication';
  let cachedJwt = '', refreshedAt = 0;
  const token = async () => {
    if (fixture.auth.convexTokenFile) {
      cachedJwt = (await privateJson<{ jwt: string }>(fixture.auth.convexTokenFile)).jwt;
    } else if (!cachedJwt || Date.now() - refreshedAt >= 40_000) {
      const auth = fixture.auth, secret = process.env[auth.clerkSecretEnv ?? 'CLERK_SECRET_KEY'];
      requireValue(typeof auth.clerkSessionId === 'string' && auth.clerkSessionId.startsWith('sess_') && typeof auth.clerkAppId === 'string' && auth.clerkAppId.startsWith('app_'), 'Private fixture session and Clerk app IDs are required.');
      requireValue(auth.clerkInstance && auth.clerkInstance === (fixture.target === 'production' ? 'prod' : 'dev'), 'Clerk instance must match the fixture target.');
      requireValue(typeof secret === 'string' && secret.startsWith(fixture.target === 'production' ? 'sk_live_' : 'sk_test_'), 'Clerk secret environment does not match the fixture target.');
      // Explicit secret-only targeting matches the fixture harness. --app or
      // --instance can invoke Platform/OAuth resolution even with a secret.
      const args = ['-y', 'clerk@latest', 'api', `/sessions/${auth.clerkSessionId}/tokens/convex`, '--secret-key', secret, '-X', 'POST', '-d', '{}'];
      // Preview before minting; never inherit stdout/stderr containing tokens.
      try { execFileSync('npx', [...args, '--dry-run'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 45_000 }); }
      catch { throw new BenchmarkError('Private token preview failed.'); }
      cachedJwt = commandJson<{ jwt: string }>('npx', [...args, '--yes']).jwt; refreshedAt = Date.now();
    }
    const claims = jwtClaims(cachedJwt);
    requireValue(claims.sub === fixture.ownerId && typeof claims.exp === 'number' && claims.exp * 1000 > Date.now() + 5000, 'Authentication must identify the fixture owner and remain unexpired.');
    return cachedJwt;
  };
  const convex = new ConvexHttpClient(fixture.convexUrl, { logger: false, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }) });
  const client = async () => { convex.setAuth(await token()); return convex; };
  const agentRead = <T>(fn: string, args: Record<string, unknown>) => commandJson<T>(process.execPath, [join(process.cwd(), 'node_modules/convex/bin/main.js'), 'run', fn, JSON.stringify(args), '--component', 'agent', '--deployment-name', fixture.deploymentName, '--env-file', fixture.usageEnvFile]);
  const allMessages = (threadId: string) => {
    const messages: StoredMessage[] = []; let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      const page: { page: StoredMessage[]; isDone: boolean; continueCursor: string } = agentRead('messages:listMessagesByThreadId', { threadId, order: 'asc', paginationOpts: { numItems: 100, cursor } });
      messages.push(...page.page); if (page.isDone) return messages; cursor = page.continueCursor;
    }
    throw new BenchmarkError('Usage pagination exceeded its bound. Further runs are blocked.');
  };
  stage = 'read-only preflight';
  agentRead('threads:listThreadsByUserId', { userId: fixture.ownerId, order: 'desc', paginationOpts: { numItems: 1, cursor: null } });
  const sourceAssets: Record<'cuts' | 'speech', Asset> = {} as Record<'cuts' | 'speech', Asset>;
  for (const [label, id] of [['cuts', fixture.sources.cutsAssetId], ['speech', fixture.sources.speechAssetId]] as const) {
    let source: Asset | undefined;
    for (const projectId of fixture.allowedSourceProjectIds) {
      const project = await (await client()).query(api.projects.get, { projectId: projectId as Id<'projects'>, includeHistory: false });
      requireValue(project.ownerId === fixture.ownerId && !project.aiRunning, 'Source-project owner or active-run check failed.');
      const assets = await (await client()).query(api.assets.list, { projectId: project._id, limit: 200 });
      if (assets.some(asset => asset._id === id)) source = await (await client()).query(api.assets.get, { projectId: project._id, assetId: id as Id<'assets'> });
    }
    requireValue(source && source.ownerId === fixture.ownerId && source.kind === 'video' && source.url, 'Allowlisted owned video source is unavailable.');
    sourceAssets[label] = source;
  }
  requireValue((sourceAssets.cuts.duration ?? 0) >= 6, 'Precise-cut and styled-edit source must contain at least six seconds.');
  const speechDuration = Math.min(sourceAssets.speech.duration ?? 0, 12);
  const transcript = sourceAssets.speech.analysis?.transcript as Transcript | undefined;
  requireValue(speechDuration > 0 && transcript?.segments.length, 'The short speech source must already have a measured transcript.');
  const relevantSegments = transcript.segments.filter(segment => segment.start < speechDuration && segment.end > 0);
  requireValue(relevantSegments.length > 0, 'Speech transcript must intersect the benchmark window.');
  const status = await (await client()).query(api.assistant.status, { projectId: sourceAssets.cuts.projectId });
  requireValue(status.configured && status.modelSwitcher && status.allowedModels?.includes('sonnet') && status.allowedModels.includes('gpt-6.1-sol'), 'Both pinned models must be enabled before creating benchmark projects.');
  await save('sources.json', { cuts: { duration: sourceAssets.cuts.duration, metadataSha256: digest({ size: sourceAssets.cuts.size, duration: sourceAssets.cuts.duration, width: sourceAssets.cuts.width, height: sourceAssets.cuts.height }) }, speech: { duration: speechDuration, transcriptSha256: digest(transcript), transcriptSegments: relevantSegments }, analysisPreparation: fixture.analysisPreparation });
  if (history) requireValue(createHash('sha256').update(await readFile(join(output, 'sources.json'))).digest('hex') === history.files.sources.sha256, 'A controlled rerun must retain the original shared media/transcript inputs.');
  const runs: Record<string, unknown>[] = [];
  const summary = () => save('results.json', { version: 1, target: fixture.target, models: fixture.models, runs, ledger: { spentUsd: ledger.spentUsd, priorKnownCostUsd: ledger.priorKnownCostUsd, currentRunSpentUsd: ledger.currentRunSpentUsd, reservedUsd: ledger.reservedUsd, ceilingUsd: ledger.ceilingUsd, blocked: ledger.blocked }, analysisPreparation: fixture.analysisPreparation, completedAt: new Date().toISOString() });
  try {
    for (const caseName of cases) {
      // Reverse the second case to reduce a fixed first-model order effect.
      const models = caseName === 'subtitles' ? [...fixture.models].reverse() : fixture.models;
      for (const model of models) {
        requireValue(!stopRequested, 'Benchmark interrupted before the next paid call.');
        requireValue(!ledger.blocked && ledger.spentUsd + ledger.perRunReserveUsd <= ledger.ceilingUsd + 1e-9, 'Remaining model-cost budget cannot reserve the next run.');
        stage = `${caseName}/${model}/create`;
        verifyBenchmarkTokenBudget(fixture);
        const original = caseName === 'subtitles' ? sourceAssets.speech : sourceAssets.cuts;
        const projectId = await (await client()).mutation(api.projects.create, { title: `${fixture.projectTitlePrefix}Benchmark ${caseName} ${model} ${Date.now()}`, aspectRatio: 'landscape', assetIds: [original._id] });
        requireValue(!fixture.allowedSourceProjectIds.includes(projectId), 'A benchmark project must be fresh and separate from source projects.');
        const result: Record<string, unknown> = { case: caseName, model, projectId, startedAt: new Date().toISOString() };
        runs.push(result); await summary();
        let project = await (await client()).query(api.projects.get, { projectId, includeHistory: false });
        requireValue(project.ownerId === fixture.ownerId && !project.threadId && !project.aiRunning, 'New benchmark project ownership or conversation check failed.');
        const clonedAssets = await (await client()).query(api.assets.list, { projectId, limit: 200 });
        const matches = clonedAssets.filter(asset => asset.kind === 'video' && ((original.r2Key && asset.r2Key === original.r2Key) || (original.storageId && asset.storageId === original.storageId)));
        requireValue(matches.length === 1, 'Fresh project must contain an unambiguous clone of the same source.');
        const cloned = await (await client()).query(api.assets.get, { projectId, assetId: matches[0]._id });
        requireValue(digest(cloned.analysis ?? {}) === digest(original.analysis ?? {}), 'Both models must receive identical saved source analysis.');
        const initial = initialTimeline(caseName, cloned._id, speechDuration);
        await (await client()).mutation(api.projects.saveTimeline, { projectId, expectedRevision: project.revision ?? 0, timeline: initial });
        const runDirectory = join(output, `${caseName}-${model}`); await mkdir(runDirectory, { mode: 0o700 });
        const prompt = casePrompt(caseName, speechDuration);
        Object.assign(result, { prompt, initialTimeline: initial, inputSha256: digest({ timeline: { ...initial, clips: initial.clips.map(clip => ({ ...clip, assetId: 'same-source' })) }, prompt, analysis: original.analysis ?? {} }) });
        if (history && caseName === history.attempt.case) requireValue(result.inputSha256 === history.attempt.inputSha256, 'The controlled rerun must retain the original timeline, prompt and saved analysis.');
        await summary();
        stage = `${caseName}/${model}/send`;
        verifyBenchmarkTokenBudget(fixture);
        ledger.reserve(); await summary();
        const startedAt = Date.now(); active = { client, projectId };
        await (await client()).mutation(api.assistant.send, { projectId, prompt, modelChoice: model === 'claude-sonnet-5-5' ? 'sonnet' : 'gpt-6.1-sol', selectedClipIds: ['benchmark-source'], playhead: 0 });
        stage = `${caseName}/${model}/wait`;
        let timedOut = false;
        while (true) {
          project = await (await client()).query(api.projects.get, { projectId, includeHistory: false });
          if (!project.aiRunning) break;
          if (stopRequested || Date.now() - startedAt >= fixture.deadlineSeconds * 1000) {
            result.stopAttempted = true; await summary();
            await (await client()).mutation(api.assistant.stop, { projectId }); timedOut = true; ledger.failClosed();
            project = await (await client()).query(api.projects.get, { projectId, includeHistory: false }); result.stopConfirmed = !project.aiRunning; break;
          }
          await sleep(1500);
        }
        active = undefined;
        result.elapsedMs = Date.now() - startedAt; result.timedOut = timedOut; result.assistantError = Boolean(project.aiError); result.finalRevision = project.revision; result.threadId = project.threadId;
        result.finalTimeline = project.timeline;
        result.checks = scoreTimeline(caseName, project.timeline as Timeline, initial, caseName === 'subtitles' ? transcript : undefined);
        stage = `${caseName}/${model}/usage`;
        requireValue(project.threadId, 'No benchmark thread was persisted. Further runs are blocked.');
        const messages = allMessages(project.threadId);
        const usage = summarizeUsage(messages, model); result.usage = usage;
        result.toolCalls = toolCalls(messages); result.failedMessages = messages.filter(message => message.status === 'failed').length;
        if (!timedOut) ledger.settle(usage.usd);
        await writeFile(join(runDirectory, 'timeline.json'), JSON.stringify({ initial, final: project.timeline, checks: result.checks }, null, 2), { mode: 0o600 });
        await summary();
        requireValue(!timedOut, 'Editing deadline reached; Stop was sent. Pending provider usage remains reserved and further runs are blocked.');
        stage = `${caseName}/${model}/export`;
        const jobId = await (await client()).mutation(api.renders.start, { projectId, resolution: 720, fps: 24, quality: 'standard' });
        result.renderJobId = jobId; await summary();
        const renderStarted = Date.now();
        let job = await (await client()).query(api.renders.get, { jobId });
        while (job.status === 'queued' || job.status === 'rendering') {
          if (stopRequested || Date.now() - renderStarted >= fixture.renderDeadlineSeconds * 1000) {
            if (job.taskId) await (await client()).mutation(api.mediaTasks.cancel, { taskId: job.taskId });
            throw new BenchmarkError('Hosted export deadline reached; its media task was cancelled.');
          }
          await sleep(2000); job = await (await client()).query(api.renders.get, { jobId });
        }
        result.renderElapsedMs = Date.now() - renderStarted; result.renderStatus = job.status;
        requireValue(job.status === 'completed' && job.url, 'Hosted export failed.');
        const response = await fetch(job.url, { signal: AbortSignal.timeout(60_000) });
        requireValue(response.ok, 'Completed export could not be downloaded.');
        const videoPath = join(runDirectory, 'export.mp4');
        await writeFile(videoPath, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 });
        const probe = commandJson<{ format: { duration: string }; streams: { codec_name: string; width?: number; height?: number; nb_frames?: string }[] }>('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames', '-show_entries', 'format=duration', '-of', 'json', videoPath]);
        const finalTimeline = project.timeline as Timeline;
        const expectedDuration = Math.max(0, ...finalTimeline.clips.map(clip => clip.start + clip.duration));
        result.export = { videoPath, probe, validDuration: Math.abs(Number(probe.format.duration) - expectedDuration) <= 1 / 24 + 0.025, validVideo: probe.streams.some(stream => stream.codec_name === 'h264' && stream.width === 1280 && stream.height === 720), sha256: createHash('sha256').update(await readFile(videoPath)).digest('hex') };
        const times = caseName === 'precise-cuts' ? [0.25, 1.25, 1.75, 2.5] : caseName === 'styled-edit' ? [0.04, 0.7, 1.5, 3, 4, 5.92] : relevantSegments.slice(0, 6).map(segment => Math.min(speechDuration - 1 / 24, (segment.start + Math.min(segment.end, speechDuration)) / 2));
        result.frames = times.map((time, i) => {
          const path = join(runDirectory, `frame-${i + 1}-${time.toFixed(3)}.png`);
          try { execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', videoPath, '-frames:v', '1', '-y', path], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }); }
          catch { throw new BenchmarkError('Export frame extraction failed.'); }
          return { time, path };
        });
        result.finishedAt = new Date().toISOString(); await summary();
        console.log(JSON.stringify({ case: caseName, model, modelUsd: usage.usd, elapsedMs: result.elapsedMs, passedChecks: (result.checks as { passed: boolean }[]).filter(check => check.passed).length, totalChecks: (result.checks as unknown[]).length, export: videoPath }));
      }
    }
  } catch (error) {
    ledger.failClosed();
    let stopSent: boolean | undefined;
    if (active) {
      try { await (await active.client()).mutation(api.assistant.stop, { projectId: active.projectId }); stopSent = true; }
      catch { stopSent = false; }
    }
    runs.push({ failureStage: stage, stopSent, message: error instanceof BenchmarkError || error instanceof BenchmarkGuardError ? error.message : 'The benchmark stopped on an unverified operation. Private error text was withheld.' });
    await summary(); throw error;
  }
  await summary();
}
function toolCalls(messages: StoredMessage[]) {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    const content = message.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) if (part && typeof part === 'object' && 'type' in part && part.type === 'tool-call' && 'toolName' in part && typeof part.toolName === 'string') counts[part.toolName] = (counts[part.toolName] ?? 0) + 1;
  }
  return counts;
}
if (require.main === module) {
  process.on('SIGINT', () => { stopRequested = true; });
  process.on('SIGTERM', () => { stopRequested = true; });
  void main().catch(error => {
    console.error(JSON.stringify({ stage, error: error instanceof BenchmarkError || error instanceof BenchmarkGuardError ? error.message : 'Benchmark failed; private error details were withheld.', stopped: true }));
    process.exitCode = 1;
  });
}
