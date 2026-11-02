import {editorCommandValidator} from './editor_command';
import {editorEditModeValidator} from './edit_mode';
import {v} from 'convex/values';
import {pinnedClaudeModelValidator} from './claude_model';

export const assistantRecoveryValidator = v.object({requests:v.array(v.string()),runId:v.string(),revision:v.number(),savedEdits:v.optional(v.number()),reason:v.string(),status:v.union(v.literal('failed'),v.literal('stopped')),updatedAt:v.number()});
export const MAX_REPAIR_PASSES = 2;

/** A turn the agent runner restarted after Cloudflare interrupted it: same request, finish what is left. */
export const continuationValidator=v.object({segment:v.number(),savedEdits:v.number(),pendingFastFrames:v.optional(v.array(v.number())),repairPass:v.optional(v.number()),feedback:v.optional(v.string())});
export const assistantRunArgs={command:v.optional(editorCommandValidator),projectId:v.id('projects'),ownerId:v.string(),runId:v.string(),threadId:v.string(),promptMessageId:v.string(),pinnedModel:v.optional(pinnedClaudeModelValidator),editMode:v.optional(editorEditModeValidator),recovery:v.optional(assistantRecoveryValidator),attachedAssetIds:v.optional(v.array(v.id('assets'))),selectedClipId:v.optional(v.string()),selectedClipIds:v.optional(v.array(v.string())),playhead:v.optional(v.number()),continuation:v.optional(continuationValidator)};
