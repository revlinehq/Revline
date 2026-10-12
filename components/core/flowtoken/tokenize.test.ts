import { describe, expect, it } from "vitest";
import { appendFlowTokens } from "./tokenize";

describe("FlowToken received chunks", () => {
  it("preserves existing chunk keys as provider updates arrive at any pace", () => {
    const first = appendFlowTokens({ input: "", tokens: [] }, "The hook");
    const second = appendFlowTokens(first, "The hook works.");
    expect(second.tokens[0]).toBe(first.tokens[0]);
    expect(second.tokens).toEqual([
      { text: "The hook", source: 0 },
      { text: " works.", source: 1 },
    ]);
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
    expect(second.tokens[1].text).toBe("ok**");
  });
});
