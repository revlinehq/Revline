import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
const crons=cronJobs();
crons.daily('Prune finished media task history',{hourUTC:9,minuteUTC:15},internal.mediaTasks.pruneFinished,{});
crons.daily('Prune rendered review snapshots',{hourUTC:9,minuteUTC:20},internal.compositionReview.prune,{});
export default crons;
