import {v} from 'convex/values';
import {pinnedClaudeModelValidator} from './claude_model';
import {assistantRecoveryValidator} from '../schema';

export const MAX_ASSISTANT_SEGMENTS=3;
export const continuationValidator=v.object({segment:v.number(),savedEdits:v.number()});
export const assistantRunArgs={projectId:v.id('projects'),ownerId:v.string(),runId:v.string(),threadId:v.string(),promptMessageId:v.string(),pinnedModel:v.optional(pinnedClaudeModelValidator),recovery:v.optional(assistantRecoveryValidator),attachedAssetIds:v.optional(v.array(v.id('assets'))),selectedClipId:v.optional(v.string()),selectedClipIds:v.optional(v.array(v.string())),playhead:v.optional(v.number())};
