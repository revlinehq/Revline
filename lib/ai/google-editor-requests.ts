import type { LanguageModelMiddleware } from 'ai';

type Schema = Record<string, unknown>;

/** Gemini reads a subset of JSON Schema: a tuple (items as a list, or prefixItems) becomes
 * an array of its first item's type with the tuple's exact length. */
function geminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== 'object') return value;
  const { prefixItems, additionalItems: _extra, ...node } = value as Schema;
  const tuple = Array.isArray(node.items) ? node.items : Array.isArray(prefixItems) ? prefixItems : null;
  if (tuple) Object.assign(node, { items: tuple[0] ?? {}, minItems: tuple.length, maxItems: tuple.length });
  return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, geminiSchema(child)]));
}

/** Requests Gemini accepts from an editor thread other models also wrote:
 * - system messages only at the start, so later context notes (the edit context, history and
 *   repair notes) become user text;
 * - tool schemas in Gemini's JSON Schema subset. */
export const googleEditorRequests: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const lead = params.prompt.findIndex(message => message.role !== 'system');
    return {
      ...params,
      prompt: params.prompt.map((message, index) => lead >= 0 && index > lead && message.role === 'system'
        ? { role: 'user' as const, content: [{ type: 'text' as const, text: message.content }] }
        : message),
      ...(params.tools ? { tools: params.tools.map(item => item.type === 'function' ? { ...item, inputSchema: geminiSchema(item.inputSchema) as typeof item.inputSchema } : item) } : {}),
    };
  },
};
