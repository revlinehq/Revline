import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';

export const CLAUDE_MODEL = 'claude-sonnet-5-5';
export const CLAUDE_GATEWAY_MODEL = 'anthropic/claude-sonnet-5.5';

export function claudeProviderOptions(modelId: string) {
  if (!/claude-sonnet-5[.-]5$/.test(modelId)) return undefined;
  const anthropic = {
    effort: 'medium',
    thinking: { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'drop_block' } },
  } satisfies AnthropicProviderOptions;
  return { anthropic };
}
