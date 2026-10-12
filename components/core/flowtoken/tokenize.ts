/** Adapted from FlowToken's SplitText diff tokenizer (Ephibbs/flowtoken, 1.0.40). */
export type FlowToken = { text: string; source: number };
export type FlowTokenState = { input: string; tokens: FlowToken[] };

export function appendFlowTokens(previous: FlowTokenState, input: string): FlowTokenState {
  if (previous.input === input) return previous;
  if (input.startsWith(previous.input)) {
    const added = input.slice(previous.input.length);
    return { input, tokens: added ? [...previous.tokens, { text: added, source: previous.tokens.length }] : previous.tokens };
  }
  // Authoritative text may be normalized or shortened when a stream settles.
  return { input, tokens: input ? [{ text: input, source: 0 }] : [] };
}
