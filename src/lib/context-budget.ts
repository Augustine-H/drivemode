import { sentences } from "./sentences.ts";
/** Conservative text-only estimate, not xAI's tokenizer. API usage is recorded separately. */
export function estimateTokens(text: string) {
  let ascii = 0,
    unicode = 0;
  for (const char of text) {
    if (char.codePointAt(0)! < 128) ascii++;
    else unicode++;
  }
  return Math.ceil(ascii / 4 + unicode * 2);
}
export function fitText(text: string, budget: number) {
  if (estimateTokens(text) <= budget) return text;
  const parts = sentences(text, true);
  let out = "";
  for (const sentence of parts) {
    if (estimateTokens(out + (out ? " " : "") + sentence) > budget) break;
    out += (out ? " " : "") + sentence;
  }
  if (out) return out.trim();
  // Only control/persona input may use this fallback. Recent turns remain whole.
  let prefix = "";
  for (const char of text) {
    if (estimateTokens(prefix + char) > budget) break;
    prefix += char;
  }
  return prefix;
}
export type ContextBudgets = {
  persona: number;
  memory: number;
  summary: number;
  recent: number;
  message: number;
};
export const DEFAULT_CONTEXT_BUDGETS: ContextBudgets = {
  persona: 4000,
  memory: 2400,
  summary: 1200,
  recent: 6000,
  message: 2400,
};
export function selectRecent<T extends { content: string }>(turns: T[], budget = 6000) {
  let used = 0,
    start = turns.length;
  while (start > 0) {
    const cost = estimateTokens(turns[start - 1].content) + 8;
    if (used + cost > budget) break;
    used += cost;
    start--;
  }
  return { recent: turns.slice(start), excluded: turns.slice(0, start), tokens: used };
}
