export class AnalysisError extends Error {
  constructor(message: string, public status: number, public retryable?: boolean) { super(message); }
}

/** Explicit provider policy wins over status defaults, including throttling. */
export function isRetryableAnalysisError(error: unknown) {
  return !(error instanceof AnalysisError) || (error.retryable ?? error.status >= 500);
}
