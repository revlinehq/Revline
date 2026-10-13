import { describe, expect, it } from 'vitest';
import { appendEvents, failureEvents, monitorHealth, redactError } from './convex-error-monitor.mjs';

describe('Convex error monitoring', () => {
  it('captures failed functions without logLines and strips argument dumps', () => {
    const [event] = failureEvents('dev-example', {
      identifier: 'projects:saveTimeline', requestId: 'request-1', executionId: 'exec-1', timestamp: 1791830000,
      error: 'ArgumentValidationError: Object contains extra field `blendMode`.\nObject: {text: "private user prompt", token: "super-secret"}\nValidator: v.object()',
    });
    expect(event.error).toContain('extra field `blendMode`');
    expect(event.error).not.toContain('private user prompt');
    expect(event.error).not.toContain('super-secret');
    expect(event.function).toBe('projects:saveTimeline');
    expect(event.timestamp).toBe(1791830000000);
  });

  it('redacts known secrets, credential patterns, URLs, email, and arbitrary payload lines', () => {
    const error = redactError('Failed password="hello world" key=known-api-secret https://media.example.com/private.mp4?signature=secret user@example.com\nprivate payload here\n    at save (convex/projects.ts:15:2)', ['known-api-secret']);
    for (const value of ['hello world', 'known-api-secret', 'media.example', 'signature', 'user@example.com', 'private payload']) expect(error).not.toContain(value);
    expect(error).toContain('convex/projects.ts:15:2');
    expect(redactError('Bearer secret-token sk-ant-secretsecret tlk_somethingsecret')).toBe('Bearer [redacted] [redacted] [redacted]');
  });

  it('records console errors without storing console payloads', () => {
    const events = failureEvents('dev', { identifier: 'upload:run', timestamp: 1, logLines: [{ level: 'ERROR', messages: ['sensitive upload context'] }] });
    expect(events).toHaveLength(1);
    expect(events[0].error).toContain('console.error');
    expect(JSON.stringify(events)).not.toContain('sensitive upload context');
    expect(failureEvents('dev', { logLines: [{ level: 'INFO', messages: ['ordinary data'] }] })).toEqual([]);
  });

  it('deduplicates history on reconnect, keeps dev/prod separate, and bounds retention', () => {
    const state = { events: [], seen: [] };
    const raw = { identifier: 'projects:saveTimeline', executionId: 'same', timestamp: 1, error: 'Failed to save' };
    expect(appendEvents(state, failureEvents('dev', raw))).toBe(1);
    expect(appendEvents(state, failureEvents('dev', raw))).toBe(0);
    expect(appendEvents(state, failureEvents('prod', raw))).toBe(1);
    for (let i = 0; i < 600; i++) appendEvents(state, failureEvents('dev', { ...raw, executionId: String(i) }));
    expect(state.events).toHaveLength(500);
    expect(state.discardedEvents).toBe(102);
    expect(appendEvents(state, failureEvents('dev', raw))).toBe(0);
  });

  it('reports a broken child stream even when the capture parent is alive', () => {
    const now = Date.now();
    const state = { updatedAt: now, deployments: {
      'majestic-alpaca-541': { state: 'streaming', lastEventAt: now - 86400000 },
      'different-gnu-398': { state: 'reconnecting', error: 'Convex CLI authentication needs attention.' },
    } };
    expect(monitorHealth(state, true, now).healthy).toBe(false);
    expect(monitorHealth(state, true, now).warnings.join(' ')).toContain('different-gnu-398: reconnecting');
    state.deployments['different-gnu-398'].state = 'waiting for events';
    expect(monitorHealth(state, true, now).healthy).toBe(true);
    expect(monitorHealth(state, true, now + 91000).warnings).toContain('The capture heartbeat is stale.');
  });
});
