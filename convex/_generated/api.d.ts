/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiCosts from "../aiCosts.js";
import type * as alertWebhooks from "../alertWebhooks.js";
import type * as assets from "../assets.js";
import type * as assistant from "../assistant.js";
import type * as assistantActions from "../assistantActions.js";
import type * as assistantWorkflow from "../assistantWorkflow.js";
import type * as billing from "../billing.js";
import type * as compositionReview from "../compositionReview.js";
import type * as crons from "../crons.js";
import type * as cutouts from "../cutouts.js";
import type * as deploymentSetup from "../deploymentSetup.js";
import type * as discordAlerts from "../discordAlerts.js";
import type * as editorAccess from "../editorAccess.js";
import type * as flyRender from "../flyRender.js";
import type * as http from "../http.js";
import type * as lib_account_limits from "../lib/account_limits.js";
import type * as lib_ai_cost from "../lib/ai_cost.js";
import type * as lib_asset_analysis from "../lib/asset_analysis.js";
import type * as lib_assistant_recovery from "../lib/assistant_recovery.js";
import type * as lib_assistant_run from "../lib/assistant_run.js";
import type * as lib_assistant_workflow from "../lib/assistant_workflow.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_billing_access from "../lib/billing_access.js";
import type * as lib_claude_model from "../lib/claude_model.js";
import type * as lib_cutout_effect_validator from "../lib/cutout_effect_validator.js";
import type * as lib_discord_alert from "../lib/discord_alert.js";
import type * as lib_editSession from "../lib/editSession.js";
import type * as lib_editSessionRebase from "../lib/editSessionRebase.js";
import type * as lib_editorToolkit from "../lib/editorToolkit.js";
import type * as lib_effect_plan from "../lib/effect_plan.js";
import type * as lib_inspectTimeline from "../lib/inspectTimeline.js";
import type * as lib_mcp_origin from "../lib/mcp_origin.js";
import type * as lib_media_storage from "../lib/media_storage.js";
import type * as lib_media_task_auth from "../lib/media_task_auth.js";
import type * as lib_project_data from "../lib/project_data.js";
import type * as lib_publicationReceipt from "../lib/publicationReceipt.js";
import type * as lib_render_seats from "../lib/render_seats.js";
import type * as lib_run_ids from "../lib/run_ids.js";
import type * as lib_share_chat from "../lib/share_chat.js";
import type * as lib_shared_media from "../lib/shared_media.js";
import type * as lib_storage_accounting from "../lib/storage_accounting.js";
import type * as lib_timeline from "../lib/timeline.js";
import type * as lib_workflows from "../lib/workflows.js";
import type * as mcp from "../mcp.js";
import type * as mcpActions from "../mcpActions.js";
import type * as mcpAuth from "../mcpAuth.js";
import type * as mcpHttp from "../mcpHttp.js";
import type * as mediaProcessor from "../mediaProcessor.js";
import type * as mediaTasks from "../mediaTasks.js";
import type * as modelDiagnostics from "../modelDiagnostics.js";
import type * as playback from "../playback.js";
import type * as processorDiagnostics from "../processorDiagnostics.js";
import type * as projectDataMigration from "../projectDataMigration.js";
import type * as projectDeletion from "../projectDeletion.js";
import type * as projectTransfers from "../projectTransfers.js";
import type * as projects from "../projects.js";
import type * as r2 from "../r2.js";
import type * as renders from "../renders.js";
import type * as storage from "../storage.js";
import type * as storageMigration from "../storageMigration.js";
import type * as timelineShares from "../timelineShares.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiCosts: typeof aiCosts;
  alertWebhooks: typeof alertWebhooks;
  assets: typeof assets;
  assistant: typeof assistant;
  assistantActions: typeof assistantActions;
  assistantWorkflow: typeof assistantWorkflow;
  billing: typeof billing;
  compositionReview: typeof compositionReview;
  crons: typeof crons;
  cutouts: typeof cutouts;
  deploymentSetup: typeof deploymentSetup;
  discordAlerts: typeof discordAlerts;
  editorAccess: typeof editorAccess;
  flyRender: typeof flyRender;
  http: typeof http;
  "lib/account_limits": typeof lib_account_limits;
  "lib/ai_cost": typeof lib_ai_cost;
  "lib/asset_analysis": typeof lib_asset_analysis;
  "lib/assistant_recovery": typeof lib_assistant_recovery;
  "lib/assistant_run": typeof lib_assistant_run;
  "lib/assistant_workflow": typeof lib_assistant_workflow;
  "lib/auth": typeof lib_auth;
  "lib/billing_access": typeof lib_billing_access;
  "lib/claude_model": typeof lib_claude_model;
  "lib/cutout_effect_validator": typeof lib_cutout_effect_validator;
  "lib/discord_alert": typeof lib_discord_alert;
  "lib/editSession": typeof lib_editSession;
  "lib/editSessionRebase": typeof lib_editSessionRebase;
  "lib/editorToolkit": typeof lib_editorToolkit;
  "lib/effect_plan": typeof lib_effect_plan;
  "lib/inspectTimeline": typeof lib_inspectTimeline;
  "lib/mcp_origin": typeof lib_mcp_origin;
  "lib/media_storage": typeof lib_media_storage;
  "lib/media_task_auth": typeof lib_media_task_auth;
  "lib/project_data": typeof lib_project_data;
  "lib/publicationReceipt": typeof lib_publicationReceipt;
  "lib/render_seats": typeof lib_render_seats;
  "lib/run_ids": typeof lib_run_ids;
  "lib/share_chat": typeof lib_share_chat;
  "lib/shared_media": typeof lib_shared_media;
  "lib/storage_accounting": typeof lib_storage_accounting;
  "lib/timeline": typeof lib_timeline;
  "lib/workflows": typeof lib_workflows;
  mcp: typeof mcp;
  mcpActions: typeof mcpActions;
  mcpAuth: typeof mcpAuth;
  mcpHttp: typeof mcpHttp;
  mediaProcessor: typeof mediaProcessor;
  mediaTasks: typeof mediaTasks;
  modelDiagnostics: typeof modelDiagnostics;
  playback: typeof playback;
  processorDiagnostics: typeof processorDiagnostics;
  projectDataMigration: typeof projectDataMigration;
  projectDeletion: typeof projectDeletion;
  projectTransfers: typeof projectTransfers;
  projects: typeof projects;
  r2: typeof r2;
  renders: typeof renders;
  storage: typeof storage;
  storageMigration: typeof storageMigration;
  timelineShares: typeof timelineShares;
  uploads: typeof uploads;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  stripe: import("@convex-dev/stripe/_generated/component.js").ComponentApi<"stripe">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  aiWorkflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"aiWorkflow">;
};
