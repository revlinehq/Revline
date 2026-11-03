/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountDeletion from "../accountDeletion.js";
import type * as accountDeletionActions from "../accountDeletionActions.js";
import type * as agentRunner from "../agentRunner.js";
import type * as agentRunnerHttp from "../agentRunnerHttp.js";
import type * as aiCosts from "../aiCosts.js";
import type * as alertWebhooks from "../alertWebhooks.js";
import type * as appleBilling from "../appleBilling.js";
import type * as appleBillingActions from "../appleBillingActions.js";
import type * as appleBillingHttp from "../appleBillingHttp.js";
import type * as assets from "../assets.js";
import type * as assistant from "../assistant.js";
import type * as assistantActions from "../assistantActions.js";
import type * as assistantMessages from "../assistantMessages.js";
import type * as assistantTurnRecovery from "../assistantTurnRecovery.js";
import type * as assistantWorkflow from "../assistantWorkflow.js";
import type * as billing from "../billing.js";
import type * as blueprints from "../blueprints.js";
import type * as brandKits from "../brandKits.js";
import type * as briefs from "../briefs.js";
import type * as compositionReview from "../compositionReview.js";
import type * as crons from "../crons.js";
import type * as cutouts from "../cutouts.js";
import type * as databaseIO from "../databaseIO.js";
import type * as deploymentSetup from "../deploymentSetup.js";
import type * as derivations from "../derivations.js";
import type * as discordAlerts from "../discordAlerts.js";
import type * as editorAccess from "../editorAccess.js";
import type * as flyProcessor from "../flyProcessor.js";
import type * as flyRender from "../flyRender.js";
import type * as fpsMigration from "../fpsMigration.js";
import type * as generatedImages from "../generatedImages.js";
import type * as http from "../http.js";
import type * as iconCache from "../iconCache.js";
import type * as icons from "../icons.js";
import type * as incidentDelivery from "../incidentDelivery.js";
import type * as incidents from "../incidents.js";
import type * as lib_account_limits from "../lib/account_limits.js";
import type * as lib_ai_cost from "../lib/ai_cost.js";
import type * as lib_apple_account_revocation from "../lib/apple_account_revocation.js";
import type * as lib_apple_entitlements from "../lib/apple_entitlements.js";
import type * as lib_apple_roots from "../lib/apple_roots.js";
import type * as lib_asset_analysis from "../lib/asset_analysis.js";
import type * as lib_assistant_recovery from "../lib/assistant_recovery.js";
import type * as lib_assistant_run from "../lib/assistant_run.js";
import type * as lib_assistant_workflow from "../lib/assistant_workflow.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_billing_access from "../lib/billing_access.js";
import type * as lib_brandKitBuild from "../lib/brandKitBuild.js";
import type * as lib_chat_data from "../lib/chat_data.js";
import type * as lib_claude_model from "../lib/claude_model.js";
import type * as lib_cutout_effect_validator from "../lib/cutout_effect_validator.js";
import type * as lib_discord_alert from "../lib/discord_alert.js";
import type * as lib_editSession from "../lib/editSession.js";
import type * as lib_editSessionRebase from "../lib/editSessionRebase.js";
import type * as lib_edit_mode from "../lib/edit_mode.js";
import type * as lib_editorToolkit from "../lib/editorToolkit.js";
import type * as lib_editorTurn from "../lib/editorTurn.js";
import type * as lib_editor_command from "../lib/editor_command.js";
import type * as lib_effect_plan from "../lib/effect_plan.js";
import type * as lib_generated_image_summary from "../lib/generated_image_summary.js";
import type * as lib_incidents from "../lib/incidents.js";
import type * as lib_inspectTimeline from "../lib/inspectTimeline.js";
import type * as lib_mcp_origin from "../lib/mcp_origin.js";
import type * as lib_media_storage from "../lib/media_storage.js";
import type * as lib_media_task_auth from "../lib/media_task_auth.js";
import type * as lib_media_task_data from "../lib/media_task_data.js";
import type * as lib_normalization_validator from "../lib/normalization_validator.js";
import type * as lib_pacing_validator from "../lib/pacing_validator.js";
import type * as lib_pixel_track_validator from "../lib/pixel_track_validator.js";
import type * as lib_processor_backend from "../lib/processor_backend.js";
import type * as lib_project_data from "../lib/project_data.js";
import type * as lib_publicationReceipt from "../lib/publicationReceipt.js";
import type * as lib_render_seats from "../lib/render_seats.js";
import type * as lib_render_snapshots from "../lib/render_snapshots.js";
import type * as lib_revision_log from "../lib/revision_log.js";
import type * as lib_run_ids from "../lib/run_ids.js";
import type * as lib_runner_auth from "../lib/runner_auth.js";
import type * as lib_save_incidents from "../lib/save_incidents.js";
import type * as lib_scene_code from "../lib/scene_code.js";
import type * as lib_share_chat from "../lib/share_chat.js";
import type * as lib_shared_media from "../lib/shared_media.js";
import type * as lib_sound_validator from "../lib/sound_validator.js";
import type * as lib_storage_accounting from "../lib/storage_accounting.js";
import type * as lib_timeline from "../lib/timeline.js";
import type * as lib_toolSaveReceipts from "../lib/toolSaveReceipts.js";
import type * as lib_tool_write_receipt from "../lib/tool_write_receipt.js";
import type * as lib_workflows from "../lib/workflows.js";
import type * as mcp from "../mcp.js";
import type * as mcpActions from "../mcpActions.js";
import type * as mcpAuth from "../mcpAuth.js";
import type * as mcpHttp from "../mcpHttp.js";
import type * as mcpUploads from "../mcpUploads.js";
import type * as mediaProcessor from "../mediaProcessor.js";
import type * as mediaTasks from "../mediaTasks.js";
import type * as memories from "../memories.js";
import type * as modelDiagnostics from "../modelDiagnostics.js";
import type * as pixelTracks from "../pixelTracks.js";
import type * as playback from "../playback.js";
import type * as processorDiagnostics from "../processorDiagnostics.js";
import type * as projectDataMigration from "../projectDataMigration.js";
import type * as projectDeletion from "../projectDeletion.js";
import type * as projectTransfers from "../projectTransfers.js";
import type * as projects from "../projects.js";
import type * as r2 from "../r2.js";
import type * as referenceReads from "../referenceReads.js";
import type * as renderSnapshotMigration from "../renderSnapshotMigration.js";
import type * as renders from "../renders.js";
import type * as saveIncidents from "../saveIncidents.js";
import type * as sceneThumbs from "../sceneThumbs.js";
import type * as storage from "../storage.js";
import type * as storageMigration from "../storageMigration.js";
import type * as superwallBilling from "../superwallBilling.js";
import type * as timelineShares from "../timelineShares.js";
import type * as timelineTabs from "../timelineTabs.js";
import type * as toolWrites from "../toolWrites.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountDeletion: typeof accountDeletion;
  accountDeletionActions: typeof accountDeletionActions;
  agentRunner: typeof agentRunner;
  agentRunnerHttp: typeof agentRunnerHttp;
  aiCosts: typeof aiCosts;
  alertWebhooks: typeof alertWebhooks;
  appleBilling: typeof appleBilling;
  appleBillingActions: typeof appleBillingActions;
  appleBillingHttp: typeof appleBillingHttp;
  assets: typeof assets;
  assistant: typeof assistant;
  assistantActions: typeof assistantActions;
  assistantMessages: typeof assistantMessages;
  assistantTurnRecovery: typeof assistantTurnRecovery;
  assistantWorkflow: typeof assistantWorkflow;
  billing: typeof billing;
  blueprints: typeof blueprints;
  brandKits: typeof brandKits;
  briefs: typeof briefs;
  compositionReview: typeof compositionReview;
  crons: typeof crons;
  cutouts: typeof cutouts;
  databaseIO: typeof databaseIO;
  deploymentSetup: typeof deploymentSetup;
  derivations: typeof derivations;
  discordAlerts: typeof discordAlerts;
  editorAccess: typeof editorAccess;
  flyProcessor: typeof flyProcessor;
  flyRender: typeof flyRender;
  fpsMigration: typeof fpsMigration;
  generatedImages: typeof generatedImages;
  http: typeof http;
  iconCache: typeof iconCache;
  icons: typeof icons;
  incidentDelivery: typeof incidentDelivery;
  incidents: typeof incidents;
  "lib/account_limits": typeof lib_account_limits;
  "lib/ai_cost": typeof lib_ai_cost;
  "lib/apple_account_revocation": typeof lib_apple_account_revocation;
  "lib/apple_entitlements": typeof lib_apple_entitlements;
  "lib/apple_roots": typeof lib_apple_roots;
  "lib/asset_analysis": typeof lib_asset_analysis;
  "lib/assistant_recovery": typeof lib_assistant_recovery;
  "lib/assistant_run": typeof lib_assistant_run;
  "lib/assistant_workflow": typeof lib_assistant_workflow;
  "lib/auth": typeof lib_auth;
  "lib/billing_access": typeof lib_billing_access;
  "lib/brandKitBuild": typeof lib_brandKitBuild;
  "lib/chat_data": typeof lib_chat_data;
  "lib/claude_model": typeof lib_claude_model;
  "lib/cutout_effect_validator": typeof lib_cutout_effect_validator;
  "lib/discord_alert": typeof lib_discord_alert;
  "lib/editSession": typeof lib_editSession;
  "lib/editSessionRebase": typeof lib_editSessionRebase;
  "lib/edit_mode": typeof lib_edit_mode;
  "lib/editorToolkit": typeof lib_editorToolkit;
  "lib/editorTurn": typeof lib_editorTurn;
  "lib/editor_command": typeof lib_editor_command;
  "lib/effect_plan": typeof lib_effect_plan;
  "lib/generated_image_summary": typeof lib_generated_image_summary;
  "lib/incidents": typeof lib_incidents;
  "lib/inspectTimeline": typeof lib_inspectTimeline;
  "lib/mcp_origin": typeof lib_mcp_origin;
  "lib/media_storage": typeof lib_media_storage;
  "lib/media_task_auth": typeof lib_media_task_auth;
  "lib/media_task_data": typeof lib_media_task_data;
  "lib/normalization_validator": typeof lib_normalization_validator;
  "lib/pacing_validator": typeof lib_pacing_validator;
  "lib/pixel_track_validator": typeof lib_pixel_track_validator;
  "lib/processor_backend": typeof lib_processor_backend;
  "lib/project_data": typeof lib_project_data;
  "lib/publicationReceipt": typeof lib_publicationReceipt;
  "lib/render_seats": typeof lib_render_seats;
  "lib/render_snapshots": typeof lib_render_snapshots;
  "lib/revision_log": typeof lib_revision_log;
  "lib/run_ids": typeof lib_run_ids;
  "lib/runner_auth": typeof lib_runner_auth;
  "lib/save_incidents": typeof lib_save_incidents;
  "lib/scene_code": typeof lib_scene_code;
  "lib/share_chat": typeof lib_share_chat;
  "lib/shared_media": typeof lib_shared_media;
  "lib/sound_validator": typeof lib_sound_validator;
  "lib/storage_accounting": typeof lib_storage_accounting;
  "lib/timeline": typeof lib_timeline;
  "lib/toolSaveReceipts": typeof lib_toolSaveReceipts;
  "lib/tool_write_receipt": typeof lib_tool_write_receipt;
  "lib/workflows": typeof lib_workflows;
  mcp: typeof mcp;
  mcpActions: typeof mcpActions;
  mcpAuth: typeof mcpAuth;
  mcpHttp: typeof mcpHttp;
  mcpUploads: typeof mcpUploads;
  mediaProcessor: typeof mediaProcessor;
  mediaTasks: typeof mediaTasks;
  memories: typeof memories;
  modelDiagnostics: typeof modelDiagnostics;
  pixelTracks: typeof pixelTracks;
  playback: typeof playback;
  processorDiagnostics: typeof processorDiagnostics;
  projectDataMigration: typeof projectDataMigration;
  projectDeletion: typeof projectDeletion;
  projectTransfers: typeof projectTransfers;
  projects: typeof projects;
  r2: typeof r2;
  referenceReads: typeof referenceReads;
  renderSnapshotMigration: typeof renderSnapshotMigration;
  renders: typeof renders;
  saveIncidents: typeof saveIncidents;
  sceneThumbs: typeof sceneThumbs;
  storage: typeof storage;
  storageMigration: typeof storageMigration;
  superwallBilling: typeof superwallBilling;
  timelineShares: typeof timelineShares;
  timelineTabs: typeof timelineTabs;
  toolWrites: typeof toolWrites;
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
