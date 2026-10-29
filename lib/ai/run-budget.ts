/** Leave time to persist a precise result before Convex's ten-minute Node limit. */
export const ASSISTANT_TOTAL_BUDGET_MS = 9 * 60_000;
// Active time is the whole run: a cut-off step discards work that was already paid for.
export const ASSISTANT_ACTIVE_BUDGET_MS = ASSISTANT_TOTAL_BUDGET_MS;

export class AssistantBudgetError extends Error {
  constructor(kind: 'active' | 'total') {
    super(kind === 'active' ? 'The editing time budget was reached. Previously saved edits remain; continue from the current timeline.' : 'This request reached its total time limit while analysis or editing was running. Previously saved edits remain; continue from the current timeline.');
    this.name = 'AssistantBudgetError';
  }
}

export class AssistantRunBudget {
  private controller = new AbortController();
  readonly signal = this.controller.signal;
  private activeTimer: ReturnType<typeof setTimeout> | undefined;
  private totalTimer: ReturnType<typeof setTimeout>;
  private remaining: number;
  private resumedAt = Date.now();
  private paused = 0;
  private inStep = false;
  private due = false;

  constructor(activeMs = ASSISTANT_ACTIVE_BUDGET_MS, totalMs = ASSISTANT_TOTAL_BUDGET_MS) {
    this.remaining = activeMs;
    this.totalTimer = setTimeout(() => this.controller.abort(new AssistantBudgetError('total')), totalMs);
    this.resumeTimer();
  }
  private resumeTimer() {
    this.resumedAt = Date.now();
    this.activeTimer = setTimeout(() => this.expire(), Math.max(0, this.remaining));
  }
  // The active budget ends between steps: a step writing a long scene finishes and its tools save it.
  // The total budget still stops everything before Convex's own limit.
  private expire() {
    if (this.inStep) this.due = true;
    else this.controller.abort(new AssistantBudgetError('active'));
  }
  stepStarted() { this.inStep = true; }
  stepEnded() {
    this.inStep = false;
    if (this.due && !this.signal.aborted) this.controller.abort(new AssistantBudgetError('active'));
  }
  pauseForAnalysis() {
    if (this.paused++ > 0) return;
    clearTimeout(this.activeTimer);
    this.remaining -= Date.now() - this.resumedAt;
  }
  resumeAfterAnalysis() {
    if (this.paused === 0 || --this.paused > 0 || this.signal.aborted) return;
    this.resumeTimer();
  }
  dispose() { clearTimeout(this.activeTimer); clearTimeout(this.totalTimer); }
}
