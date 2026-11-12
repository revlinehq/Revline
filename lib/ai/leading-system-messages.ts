import type { LanguageModelMiddleware } from 'ai';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';

type PromptMessage = LanguageModelV4Prompt[number];

/** A turn-scoped note (`clearAt: 'next_user_message'`): Claude renders it for one step and keeps it, cleared, in the prefix. */
function turnScoped(message: PromptMessage) {
  return message.role === 'system' && message.providerOptions?.anthropic?.clearAt !== undefined;
}

/** System messages only at the start of the prompt: later context notes (the edit context, history and
 * repair notes) become user text. Claude rejects them after an assistant turn. A turn-scoped note stays a
 * system message where Claude accepts one: after a user or tool message, and last or before an assistant turn. */
export const leadingSystemMessages: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const lead = params.prompt.findIndex(message => message.role !== 'system');
    const prompt: PromptMessage[] = [];
    params.prompt.forEach((message, index) => {
      if (lead < 0 || index <= lead || message.role !== 'system') { prompt.push(message); return; }
      const before = prompt.at(-1)?.role, after = params.prompt[index + 1]?.role;
      if (turnScoped(message) && (before === 'user' || before === 'tool') && (after === undefined || after === 'assistant')) { prompt.push(message); return; }
      prompt.push({ role: 'user', content: [{ type: 'text', text: message.content }] });
    });
    return { ...params, prompt };
  },
};
