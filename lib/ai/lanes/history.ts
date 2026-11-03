import type { ModelMessage } from 'ai';
import { LANES, laneToolAllowed, type LaneId } from './index';

/** Keep one conversation while removing other lanes’ tool and skill instructions from model context. */
export function laneHistory(
  messages: ModelMessage[],
  lane: LaneId,
): ModelMessage[] {
  const blocked = new Set<string>(),
    skills = new Set(LANES[lane].skills.map((skill) => skill.name));
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const value of message.content) {
      const part = value as {
        type: string;
        toolName?: string;
        toolCallId?: string;
        input?: unknown;
      };
      if (part.type !== 'tool-call' || !part.toolCallId) continue;
      const input = part.input as { name?: string } | undefined;
      if (
        !laneToolAllowed(lane, part.toolName ?? '') ||
        (part.toolName === 'readSkill' &&
          (!input?.name || !skills.has(input.name)))
      )
        blocked.add(part.toolCallId);
    }
  }
  return messages.flatMap((message) => {
    if (!Array.isArray(message.content)) return [message];
    const content = message.content.filter((value) => {
      const part = value as {
        type: string;
        toolName?: string;
        toolCallId?: string;
      };
      if (part.type !== 'tool-call' && part.type !== 'tool-result') return true;
      return (
        laneToolAllowed(lane, part.toolName ?? '') &&
        (!part.toolCallId || !blocked.has(part.toolCallId))
      );
    });
    return content.length ? [{ ...message, content } as ModelMessage] : [];
  });
}
