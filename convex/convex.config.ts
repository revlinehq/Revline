import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import stripe from "@convex-dev/stripe/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
const app = defineApp();
app.use(agent);
app.use(stripe);
app.use(workflow);
// AI turns hold a step for a whole model call, so they get their own pool and cannot
// starve the short media-task steps that drive uploads and exports.
app.use(workflow, { name: 'aiWorkflow' });
export default app;
