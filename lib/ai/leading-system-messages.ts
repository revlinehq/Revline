import type { LanguageModelMiddleware } from 'ai';

/** System messages only at the start of the prompt: later context notes (the edit context, history and
 * repair notes) become user text. Claude rejects them after an assistant turn. */
export const leadingSystemMessages: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const lead = params.prompt.findIndex(message => message.role !== 'system');
    return {
      ...params,
      prompt: params.prompt.map((message, index) => lead >= 0 && index > lead && message.role === 'system'
        ? { role: 'user' as const, content: [{ type: 'text' as const, text: message.content }] }
        : message),
    };
  },
};
