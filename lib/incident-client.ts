import { incidentContext, incidentText } from './incidents';

type ClientIncident = { source: string; kind: string; message: string; stack?: string; context: unknown; projectId?: string };
let send: ((incident: ClientIncident) => Promise<unknown>) | undefined;
const recent = new Map<string, number>();
const seen = new WeakSet<object>();

export function configureIncidentClient(reporter: NonNullable<typeof send>) { send = reporter; }

export function reportClientIncident(incident: ClientIncident) {
  if (typeof window === 'undefined' || !send) return;
  const projectId = /^\/(?:editor|chat)\/([a-z0-9]+)(?:\/|$)/.exec(window.location.pathname)?.[1];
  const safe = { ...incident, ...(projectId ? { projectId } : {}), message: incidentText(incident.message), stack: incident.stack ? incidentText(incident.stack, 6000) : undefined, context: JSON.parse(incidentContext(incident.context)) };
  const key = JSON.stringify(safe);
  const now = Date.now();
  if (now - (recent.get(key) ?? 0) < 60_000) return;
  if (recent.size >= 100) recent.delete(recent.keys().next().value ?? '');
  recent.set(key, now);
  // A reporting failure must never report itself or affect the original operation.
  void send(safe).catch(() => {});
}

export function reportClientFailure(error: unknown, location = 'client:userError') {
  if (typeof window === 'undefined') return;
  if (error && typeof error === 'object') { if (seen.has(error)) return; seen.add(error); }
  let message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Client operation failed';
  if (error && typeof error === 'object' && 'data' in error && typeof error.data === 'string') message = error.data;
  reportClientIncident({ source: 'client', kind: 'user-failure', message, stack: error instanceof Error ? error.stack : undefined, context: { location } });
}

export function installUncaughtIncidentHandlers() {
  window.addEventListener('error', event => reportClientFailure(event.error ?? event.message, 'window:error'));
  window.addEventListener('unhandledrejection', event => reportClientFailure(event.reason, 'window:unhandledrejection'));
}
