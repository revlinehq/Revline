import type { ModelMessage } from 'ai';
import type { LaneId } from './types';

const instructionTools = new Set(['readSkill', 'switchLane', 'setLane', 'loadCapability']);

/** Retain evidence across styles, retire old instructions, and keep complete tool pairs. */
export function laneHistory(messages: ModelMessage[], lane: LaneId): ModelMessage[] {
  const calls = new Map<string, string>(), paired = new Set<string>();
  let currentTurn = -1;
  messages.forEach((message, index) => {
    if (message.role === 'user') currentTurn = index;
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) if (part.type === 'tool-call') calls.set(part.toolCallId, part.toolName);
    }
    if (message.role === 'tool') {
      for (const part of message.content) if (part.type === 'tool-result' && calls.get(part.toolCallId) === part.toolName) paired.add(part.toolCallId);
    }
  });
  return messages.flatMap((message, index): ModelMessage[] => {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const content = message.content.filter(part => part.type !== 'tool-call' || paired.has(part.toolCallId));
      return content.length ? [{ ...message, content }] : [];
    }
    if (message.role !== 'tool') return [message];
    const content = message.content.filter(part => part.type !== 'tool-result' || paired.has(part.toolCallId)).map(part => {
      if (part.type !== 'tool-result' || !instructionTools.has(part.toolName)) return part;
      const output = part.output;
      if (output.type === 'error-text' || output.type === 'error-json') return part;
      const value = output.type === 'json' ? output.value : undefined;
      const sameStyle = value && typeof value === 'object' && 'lane' in value && value.lane === lane;
      // Only this turn's skill body for the current style is still prescriptive.
      if (part.toolName === 'readSkill' && index > currentTurn && sameStyle) return part;
      const name = value && typeof value === 'object' && 'name' in value ? value.name : undefined;
      const page = value && typeof value === 'object' && 'page' in value ? value.page : undefined;
      return { ...part, output: { type: 'text' as const, value: `Earlier ${part.toolName}${typeof name === 'string' ? ` ${name}` : ''}${typeof page === 'string' ? `/${page}` : ''} instructions retired. Follow the current workflow and latest user decisions. Read the skill again only if needed.` } };
    });
    return content.length ? [{ ...message, content }] : [];
  });
}
