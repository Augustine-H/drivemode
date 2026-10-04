// Whole sentences for memory/voice selection. TTS chunking happens afterwards.
export function sentences(text: string, done = true) {
  const parts: string[] = [];
  let start = 0;
  const boundary = /[!?。！？…]+["'”’)]*|(?<!\d)\.(?!\d)["'”’)]*|\n+/g;
  for (const match of text.matchAll(boundary)) {
    const end = match.index + match[0].length;
    const part = text.slice(start, end).trim();
    if (part) parts.push(part);
    start = end;
  }
  if (done && text.slice(start).trim()) parts.push(text.slice(start).trim());
  return parts;
}
