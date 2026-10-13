import { describe, expect, it } from "vitest";
import { appendFlowTokens } from "./tokenize";

describe("FlowToken received chunks", () => {
  it("preserves existing chunk keys as provider updates arrive at any pace", () => {
    const first = appendFlowTokens({ input: "", tokens: [] }, "The hook");
    const second = appendFlowTokens(first, "The hook works.");
    expect(second.tokens[0]).toBe(first.tokens[0]);
    expect(second.tokens.map(token => token.text).join('')).toBe('The hook works.');
    expect(second.tokens.slice(0, first.tokens.length)).toEqual(first.tokens);
    expect(new Set(second.tokens.map(token => token.source)).size).toBe(second.tokens.length);
    expect(appendFlowTokens(second, second.input)).toBe(second);
  });

  it.each(["Changed answer", "A", ""])("replaces a rewritten or shortened response without stale text: %s", (input) => {
    const before = appendFlowTokens({ input: "", tokens: [] }, "An older answer");
    const after = appendFlowTokens(before, input);
    expect(after.tokens.map((token) => token.text).join("")).toBe(input);
  });

  it("keeps exact Unicode, whitespace, and partial tokens without a playback queue", () => {
    const first = appendFlowTokens({ input: "", tokens: [] }, "🦔 视频\n  **ho");
    const second = appendFlowTokens(first, "🦔 视频\n  **hook**");
    expect(second.tokens.map((token) => token.text).join("")).toBe(second.input);
    expect(second.tokens.at(-1)?.text).toBe("ok**");
  });
  it('keeps the unchanged prefix mounted when persisted text is normalized', () => {
    const before = appendFlowTokens({ input: '', tokens: [] }, 'Your edit ready');
    const after = appendFlowTokens(before, 'Your edit is ready.');
    expect(after.tokens[0]).toBe(before.tokens[0]);
    expect(after.tokens[1]).toBe(before.tokens[1]);
    expect(after.tokens.map(token => token.text).join('')).toBe('Your edit is ready.');
    expect(after.tokens.at(-1)?.source).toBeGreaterThan(before.tokens.at(-1)!.source);
  });
  it('does not reuse a rewritten token key when streaming continues', () => {
    const before = appendFlowTokens({ input: '', tokens: [] }, 'Your edit is nearly ready');
    const rewritten = appendFlowTokens(before, 'Your edit is ready.');
    const after = appendFlowTokens(rewritten, 'Your edit is ready. Play it now.');
    expect(after.tokens.slice(0, rewritten.tokens.length)).toEqual(rewritten.tokens);
    expect(new Set(after.tokens.map(token => token.source)).size).toBe(after.tokens.length);
    expect(after.tokens.map(token => token.text).join('')).toBe(after.input);
  });
});
