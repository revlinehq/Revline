/** Load at most sixty extra raw messages while a tool-heavy turn hides its user prompt. */
export class AssistantHistoryExpansion {
  private threadId: string | undefined;
  private requests = 0;
  private lastPage: string | undefined;
  next(threadId: string, status: string, messages: readonly { id: string; role: string }[]): boolean {
    if (threadId !== this.threadId) { this.threadId = threadId; this.requests = 0; this.lastPage = undefined; }
    if (status !== 'CanLoadMore' || !messages.length || messages.some(message => message.role === 'user') || this.requests >= 3) return false;
    // Streaming updates to the same partial turn must never repeat a page request.
    const page = messages.map(message => message.id).join('|');
    if (page === this.lastPage) return false;
    this.lastPage = page;
    this.requests++;
    return true;
  }
}
