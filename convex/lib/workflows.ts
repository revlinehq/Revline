import { WorkflowManager } from '@convex-dev/workflow';
import { components } from '../_generated/api';

// Separate pools: a media task's steps are short mutations around a worker, while an AI
// turn's step runs a whole model call. Sharing one pool let busy chats delay every upload.
export const mediaWorkflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: 20 },
});
export const aiWorkflow = new WorkflowManager(components.aiWorkflow, {
  workpoolOptions: { maxParallelism: 40 },
});
