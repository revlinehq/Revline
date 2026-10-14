import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AssistantBudgetError, AssistantRunBudget } from './run-budget';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
test('background analysis does not consume the active editing budget', () => {
  const budget = new AssistantRunBudget(300_000, 600_000);
  vi.advanceTimersByTime(100_000); budget.pauseForAnalysis(); vi.advanceTimersByTime(240_000);
  expect(budget.signal.aborted).toBe(false); budget.resumeAfterAnalysis(); vi.advanceTimersByTime(199_999);
  expect(budget.signal.aborted).toBe(false); vi.advanceTimersByTime(1);
  expect(budget.signal.reason).toBeInstanceOf(AssistantBudgetError); expect(budget.signal.reason.message).toContain('editing time budget'); budget.dispose();
});
test('the total deadline still ends repeated analysis waits with a specific cause', () => {
  const budget = new AssistantRunBudget(300_000, 540_000);
  budget.pauseForAnalysis(); vi.advanceTimersByTime(540_000);
  expect(budget.signal.reason.message).toContain('total time limit'); budget.dispose();
});
test('parallel analysis pauses share one suspended clock and timers are disposed', () => {
  const budget = new AssistantRunBudget(100, 1000);
  budget.pauseForAnalysis(); budget.pauseForAnalysis(); vi.advanceTimersByTime(200); budget.resumeAfterAnalysis(); vi.advanceTimersByTime(200);
  expect(budget.signal.aborted).toBe(false); budget.resumeAfterAnalysis(); vi.advanceTimersByTime(99); expect(budget.signal.aborted).toBe(false);
  budget.dispose(); vi.advanceTimersByTime(1000); expect(budget.signal.aborted).toBe(false);
});
