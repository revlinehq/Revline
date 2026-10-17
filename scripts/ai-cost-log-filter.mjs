/** Keep only our structured cost events; never echo unrelated backend logs. */
export function aiCostLines(line) {
  let execution;
  try { execution = JSON.parse(line); } catch { return []; }
  if (!Array.isArray(execution?.logLines)) return [];
  return execution.logLines.flatMap(log => {
    if (log?.isTruncated || !Array.isArray(log?.messages)) return [];
    const raw = log.messages.join(' ');
    // Convex's CLI can serialize a string message with outer single quotes.
    const message = raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw;
    if (!message.startsWith('[ai-cost] ')) return [];
    try {
      const event = JSON.parse(message.slice('[ai-cost] '.length));
      if (!['model-step', 'anomaly', 'run-summary'].includes(event.event) || typeof event.projectId !== 'string' || typeof event.runId !== 'string') return [];
      return [`[ai-cost] ${JSON.stringify(event)}`];
    } catch { return []; }
  });
}
