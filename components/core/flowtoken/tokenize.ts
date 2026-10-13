/** Adapted from FlowToken's SplitText diff tokenizer (Ephibbs/flowtoken, 1.0.40). */
export type FlowToken = { text: string; source: number };
export type FlowTokenState = { input: string; tokens: FlowToken[] };

export function appendFlowTokens(previous: FlowTokenState, input: string): FlowTokenState {
  if (previous.input === input) return previous;
  if (input.startsWith(previous.input)) {
    const added = input.slice(previous.input.length);
    // Preserve the received batch immediately; word boundaries only give text stable keys.
    const chunks = added.match(/\S+\s*|\s+/gu) ?? [];
    const nextSource = Math.max(-1, ...previous.tokens.map(token => token.source)) + 1;
    return { input, tokens: [...previous.tokens, ...chunks.map((text, index) => ({ text, source: nextSource + index }))] };
  }
  // Authoritative text may be normalized or shortened when a stream settles.
  let shared = 0;
  while (shared < Math.min(input.length, previous.input.length) && input[shared] === previous.input[shared]) shared++;
  let length = 0;
  const retained = previous.tokens.filter(token => { length += token.text.length; return length <= shared; });
  const retainedText = retained.map(token => token.text).join('');
  const nextSource = Math.max(-1, ...previous.tokens.map(token => token.source)) + 1;
  const tail = input.slice(retainedText.length);
  return { input, tokens: [...retained, ...(tail ? [{ text: tail, source: nextSource }] : [])] };
}
