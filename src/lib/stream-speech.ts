import { chunkText } from "./transcript.ts";

// Publish complete sentences only. Their indices never change as more tokens arrive.
export function speechParts(text: string, done = false): string[] {
  const parts: string[] = [];
  let start = 0;
  const boundary = /[!?。！？…]+["'”’)]*|(?<!\d)\.(?!\d)["'”’)]*|\n+/g;
  for (const match of text.matchAll(boundary)) {
    const end = match.index + match[0].length;
    parts.push(...chunkText(text.slice(start, end)));
    start = end;
  }
  if (done) parts.push(...chunkText(text.slice(start)));
  return parts;
}
