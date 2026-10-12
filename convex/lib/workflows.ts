import { WorkflowManager } from '@convex-dev/workflow';
import { components } from '../_generated/api';

export const mediaWorkflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: 10 },
});
