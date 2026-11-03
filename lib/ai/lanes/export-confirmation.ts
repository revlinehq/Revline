/** Export authorization comes from the current user request, never a tool-supplied confirmation flag. */
export function exportConfirmed(request: string): boolean {
  return (
    /(?:^\s*(?:please\s+)?(?:export\b|render\b.{0,30}\bmp4\b)|\b(?:yes|confirmed|go ahead|please|can you|could you|would you)\b.{0,30}\bexport\b)/i.test(
      request,
    ) &&
    !/\b(?:never|no|without|don't|do not|don’t)\b.{0,60}\bexport\b/i.test(
      request,
    )
  );
}
