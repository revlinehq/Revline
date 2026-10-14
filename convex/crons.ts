import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
const crons=cronJobs();
crons.daily('Prune finished media task history',{hourUTC:9,minuteUTC:15},internal.mediaTasks.pruneFinished,{});
export default crons;
