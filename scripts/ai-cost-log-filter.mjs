/** Keep only our structured cost events; never echo unrelated backend logs. */
export function aiCostLines(line) {
  let execution;
  try { execution = JSON.parse(line); } catch { return []; }
  if (!Array.isArray(execution?.logLines)) return [];
  return execution.logLines.flatMap(log => {
    if (log?.isTruncated || !Array.isArray(log?.messages)) return [];
    const message = log.messages.join(' ');
    if (!message.startsWith('[ai-cost] ')) return [];
    try {
      const event = JSON.parse(message.slice('[ai-cost] '.length));
      if (!['model-step', 'anomaly', 'run-summary'].includes(event.event) || typeof event.projectId !== 'string' || typeof event.runId !== 'string') return [];
      return [`[ai-cost] ${JSON.stringify(event)}`];
    } catch { return []; }
  });
}
