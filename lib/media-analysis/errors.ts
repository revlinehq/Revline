export class AnalysisError extends Error {
  constructor(message: string, public status: number, public retryable?: boolean) { super(message); }
}
