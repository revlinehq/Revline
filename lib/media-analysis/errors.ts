export class AnalysisError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
