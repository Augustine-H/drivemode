// Pure, prefix-stable phrase buffering; never submit an individual LLM token.
export function ttsUnits(text: string, done = false, minimum = 5, maximum = 180): string[] {
  const result: string[] = [];
  let start = 0;
  const boundary = /[!?。！？…]+["'”’)]*|(?<!\d)\.(?!\d)["'”’)]*|,\s|\n+|(?:습니다|합니다|해요|예요|이에요|세요|입니다|한다|됐다|있다|없다)\s/g;
  while (start < text.length) {
    while (start < text.length && /\s/.test(text[start])) start++;
    if (start >= text.length) break;
    boundary.lastIndex = start;
    let match: RegExpExecArray | null;
    let end = -1;
    while ((match = boundary.exec(text))) {
      const candidate = match.index + match[0].length;
      if (candidate - start > maximum) break;
      if (text.slice(start,candidate).trim().length >= minimum) { end = candidate; break; }
    }
    if (end < 0 && text.length - start >= maximum) {
      const window = text.slice(start,start+maximum);
      const space = window.lastIndexOf(' ');
      end = start + (space >= maximum/2 ? space+1 : maximum);
    }
    if (end < 0) { if (done && text.slice(start).trim()) result.push(text.slice(start).trim()); break; }
    const part = text.slice(start,end).trim(); if (part) result.push(part);
    start = end;
  }
  return result;
}
