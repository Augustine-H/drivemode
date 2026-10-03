export type SpeechResult = { isFinal?: boolean; 0?: { transcript?: string } };
export type SpeechEvent = { results: ArrayLike<SpeechResult> };

export function mergeUtterance(previous: string, incoming: string) {
  const prev = previous.replace(/\s+/g, " ").trim();
  const next = incoming.replace(/\s+/g, " ").trim();
  if (!prev) return next;
  if (!next) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.startsWith(next)) return prev;
  const limit = Math.min(prev.length, next.length);
  for (let size = limit; size >= 2; size -= 1) {
    if (prev.slice(-size) === next.slice(0, size)) return `${prev}${next.slice(size)}`;
  }
  return `${prev} ${next}`;
}

export function collapseStutter(text: string) {
  let out = text.replace(/\s+/g, " ").trim();
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(/([가-힣]{2,8})\1+/g, "$1");
  }
  return out;
}

export function sessionTranscript(event: SpeechEvent) {
  let finals = "";
  let interim = "";
  for (let i = 0; i < event.results.length; i += 1) {
    const row = event.results[i];
    const piece = (row?.[0]?.transcript ?? "").replace(/\s+/g, " ").trim();
    if (!piece) continue;
    if (row?.isFinal) {
      finals = mergeUtterance(finals, piece);
      interim = "";
    } else interim = piece;
  }
  return collapseStutter(mergeUtterance(finals, interim));
}
