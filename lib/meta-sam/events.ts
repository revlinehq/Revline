/** Decode Meta's streamed Responses events, including chunks split inside UTF-8 or SSE records. */
export async function* samEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  function parse(block: string) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const event: unknown = JSON.parse(data);
    if (!event || typeof event !== 'object' || !('type' in event) || typeof event.type !== 'string') throw new Error('Meta returned an unreadable stream event.');
    return event as Record<string, unknown> & { type: string };
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        const block = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        const event = parse(block);
        if (event) yield event;
      }
      if (done) {
        const event = parse(pending);
        if (event) yield event;
        return;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
