/** Display budgets, in characters, for the text of a choice card (askUser).
 * The card is at most 420 px wide: at 390 px a label fits two lines and a description three (one more beside a play button). */
export const CHOICE_TEXT = { question: 300, label: 60, description: 140 } as const;

/** One line of card text: whitespace and newlines collapsed, then cut to the budget at a word boundary with an ellipsis. */
export function fitChoiceText(value: string, budget: number): { text: string; shortened: boolean } {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= budget) return { text, shortened: false };
  // Never leave half of a surrogate pair (an emoji) at the cut.
  const cut = text.slice(0, budget - 1).replace(/[\uD800-\uDBFF]$/, '');
  const space = cut.lastIndexOf(' ');
  // A word boundary in the last third keeps most of the budget; otherwise (one long word, a URL) cut mid-word.
  const kept = (space >= budget * 2 / 3 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?\-–—(]+$/, '');
  return { text: `${kept || cut}…`, shortened: true };
}

/** What the tool result tells the model when card text was cut, so it writes shorter next time without retrying. */
export function shortenedNote(fields: string[]) {
  return fields.length ? { shortened: fields, note: `Nothing failed. ${fields.join(', ')} ${fields.length === 1 ? 'was' : 'were'} over the display budget and shortened with an ellipsis; do not ask again. Next time keep a question to ${CHOICE_TEXT.question} characters, a label to ${CHOICE_TEXT.label} and a description to ${CHOICE_TEXT.description}.` } : {};
}
