import type { StreamTextTransform, TextStreamPart, ToolSet } from 'ai';

type Part = TextStreamPart<ToolSet>;
type InputDelta = Extract<Part, { type: 'tool-input-delta' }>;

/** Tool input (scene code, timelines) streams a few characters per part, and every saved chat delta
 * part carries its ids again, so stored deltas were mostly overhead. Merge consecutive input deltas
 * of one call into parts of about 1 KB before the agent saves them. */
// The part shape does not depend on the tool set; `any` lets streamText keep inferring its own tools.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mergeToolInputDeltas(): StreamTextTransform<any> {
  return () => {
    let pending: InputDelta | undefined;
    return new TransformStream<Part, Part>({
      transform(part, controller) {
        if (part.type === 'tool-input-delta' && !part.providerMetadata) {
          if (pending?.id === part.id) pending = { ...pending, delta: pending.delta + part.delta };
          else { if (pending) controller.enqueue(pending); pending = part; }
          if (pending.delta.length >= 1024) { controller.enqueue(pending); pending = undefined; }
          return;
        }
        if (pending) { controller.enqueue(pending); pending = undefined; }
        controller.enqueue(part);
      },
      flush(controller) { if (pending) controller.enqueue(pending); },
    });
  };
}
