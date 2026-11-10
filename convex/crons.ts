import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
const crons=cronJobs();
crons.interval('Prune tool save receipts',{minutes:10},internal.toolWrites.prune,{});
crons.daily('Prune finished media task history',{hourUTC:9,minuteUTC:15},internal.mediaTasks.pruneFinished,{});
crons.daily('Prune rendered review snapshots',{hourUTC:9,minuteUTC:20},internal.compositionReview.prune,{});
crons.daily('Prune delivered Discord alert receipts',{hourUTC:9,minuteUTC:25},internal.discordAlerts.prune,{});
crons.interval('Fail stalled exports',{minutes:2},internal.renders.failStalled,{});
crons.daily('Prune MCP tokens, codes and unused clients',{hourUTC:9,minuteUTC:30},internal.mcpAuth.prune,{});
crons.interval('Recover Railway workers and expired chunk services',{minutes:1},internal.railwayWorkers.dispatch,{});
crons.daily('Prune cached timeline frames', {hourUTC:9,minuteUTC:35}, internal.frameCache.prune, {});
crons.interval('Prune expired agent bridge nonces',{minutes:10},internal.agentRunner.pruneNonces,{});
// Does nothing unless CAMPAIGN_READER_ENABLED is set on the deployment (convex/campaignsReader.ts).
crons.interval('Read public clipping campaigns',{hours:1},internal.campaignsReader.tick,{});
export default crons;
