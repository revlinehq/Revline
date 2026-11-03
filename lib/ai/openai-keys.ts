import { createOpenAI } from '@ai-sdk/openai';

/** The OpenAI key every editor request uses. */
export function activeOpenAIKey() {
  return process.env.OPENAI_API_KEY?.trim() || '';
}

/** The editor's OpenAI provider. */
export function editorOpenAI() {
  return createOpenAI({ apiKey: activeOpenAIKey() });
}
