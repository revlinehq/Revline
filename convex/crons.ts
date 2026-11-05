import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
const crons=cronJobs();
crons.interval('Prune tool save receipts',{minutes:10},internal.toolWrites.prune,{});
crons.daily('Prune finished media task history',{hourUTC:9,minuteUTC:15},internal.mediaTasks.pruneFinished,{});
crons.daily('Prune rendered review snapshots',{hourUTC:9,minuteUTC:20},internal.compositionReview.prune,{});
crons.daily('Prune delivered Discord alert receipts',{hourUTC:9,minuteUTC:25},internal.discordAlerts.prune,{});
crons.interval('Fail stalled exports',{minutes:10},internal.renders.failStalled,{});
crons.daily('Prune MCP tokens, codes and unused clients',{hourUTC:9,minuteUTC:30},internal.mcpAuth.prune,{});
// Exports re-queued by an expired lease or a failed Fly call get a machine within a minute; a no-op unless RENDER_PROVIDER=fly.
crons.interval('Dispatch waiting exports to Fly',{minutes:1},internal.flyRender.dispatch,{});
crons.interval('Recover waiting media processing',{minutes:1},internal.flyProcessor.dispatch,{});
crons.interval('Recover Railway workers and expired chunk services',{minutes:1},internal.railwayWorkers.dispatch,{});
crons.daily('Prune cached timeline frames', {hourUTC:9,minuteUTC:35}, internal.frameCache.prune, {});
export default crons;
