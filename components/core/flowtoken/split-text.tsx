"use client";

import { useState, type CSSProperties } from "react";
import { appendFlowTokens, type FlowTokenState } from "./tokenize";
import "./styles.css";

export type FlowTokenTextProps = {
  input: string;
  animation?: "fadeIn" | null;
  animationDuration?: string;
  animationTimingFunction?: string;
};

/** FlowToken's diff-token fade, vendored locally; see ORIGIN.md. */
export function FlowTokenText({ input, animation = "fadeIn", animationDuration = "0.6s",
  animationTimingFunction = "ease-in-out" }: FlowTokenTextProps) {
  const [state, setState] = useState<FlowTokenState>(() => appendFlowTokens({ input: "", tokens: [] }, input));
  // A later live-state update must not animate the snapshot already on screen.
  const [animateFirstChunk] = useState(animation !== null);
  if (state.input !== input) setState(appendFlowTokens(state, input));
  const tokens = state.input === input ? state.tokens : appendFlowTokens(state, input).tokens;
  const style: CSSProperties = {
    animationDuration,
    animationTimingFunction,
    animationIterationCount: 1,
    whiteSpace: "pre-wrap",
  };
  return tokens.map((token) => <span key={token.source} data-flow-token=""
    style={{ ...style, animationName: animation && (token.source !== 0 || animateFirstChunk) ? "ft-fadeIn" : "none" }}>{token.text}</span>);
}
