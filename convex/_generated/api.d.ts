/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assets from "../assets.js";
import type * as assistant from "../assistant.js";
import type * as assistantActions from "../assistantActions.js";
import type * as billing from "../billing.js";
import type * as crons from "../crons.js";
import type * as editorAccess from "../editorAccess.js";
import type * as http from "../http.js";
import type * as lib_assistant_recovery from "../lib/assistant_recovery.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_billing_access from "../lib/billing_access.js";
import type * as lib_claude_model from "../lib/claude_model.js";
import type * as lib_editSession from "../lib/editSession.js";
import type * as lib_editSessionRebase from "../lib/editSessionRebase.js";
import type * as lib_inspectTimeline from "../lib/inspectTimeline.js";
import type * as lib_media_storage from "../lib/media_storage.js";
import type * as lib_media_task_auth from "../lib/media_task_auth.js";
import type * as lib_publicationReceipt from "../lib/publicationReceipt.js";
import type * as lib_shared_media from "../lib/shared_media.js";
import type * as lib_storage_accounting from "../lib/storage_accounting.js";
import type * as lib_timeline from "../lib/timeline.js";
import type * as lib_workflows from "../lib/workflows.js";
import type * as mediaProcessor from "../mediaProcessor.js";
import type * as mediaTasks from "../mediaTasks.js";
import type * as playback from "../playback.js";
import type * as processorDiagnostics from "../processorDiagnostics.js";
import type * as projectDeletion from "../projectDeletion.js";
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
  assets: typeof assets;
  assistant: typeof assistant;
  assistantActions: typeof assistantActions;
  billing: typeof billing;
  crons: typeof crons;
  editorAccess: typeof editorAccess;
  http: typeof http;
  "lib/assistant_recovery": typeof lib_assistant_recovery;
  "lib/auth": typeof lib_auth;
  "lib/billing_access": typeof lib_billing_access;
  "lib/claude_model": typeof lib_claude_model;
  "lib/editSession": typeof lib_editSession;
  "lib/editSessionRebase": typeof lib_editSessionRebase;
  "lib/inspectTimeline": typeof lib_inspectTimeline;
  "lib/media_storage": typeof lib_media_storage;
  "lib/media_task_auth": typeof lib_media_task_auth;
  "lib/publicationReceipt": typeof lib_publicationReceipt;
  "lib/shared_media": typeof lib_shared_media;
  "lib/storage_accounting": typeof lib_storage_accounting;
  "lib/timeline": typeof lib_timeline;
  "lib/workflows": typeof lib_workflows;
  mediaProcessor: typeof mediaProcessor;
  mediaTasks: typeof mediaTasks;
  playback: typeof playback;
  processorDiagnostics: typeof processorDiagnostics;
  projectDeletion: typeof projectDeletion;
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
};
