/** Only standalone conversation bypasses preparation; mixed editing requests wait. */
export function isCasualChat(prompt: string) {
  return /^(?:yo+|hi+|hey+|hello|hiya|sup|what'?s up|how are you|thanks|thank you|ok(?:ay)?|cool|nice)[\s!?.]*$/i.test(prompt.trim());
}
