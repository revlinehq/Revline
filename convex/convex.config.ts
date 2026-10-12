import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import stripe from "@convex-dev/stripe/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
const app = defineApp();
app.use(agent);
app.use(stripe);
app.use(workflow);
export default app;
