import { ttsUnits } from "./tts-chunking.ts";
import { sentences } from "./sentences.ts";
export function voiceResponse(full: string, done = true) {
  const clean = full
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/!?\[[^\]]*]\([^)]*$/g, " ")
    .replace(/!?\[[^\]]*$/g, " ")
    .replace(/https?:\/\/\S*/g, " ")
    .replace(/^[ \t]*\|.*(?:\n|$)/gm, " ")
    .replace(/^[ \t#>*-]+/gm, "")
    .replace(/[*_`]/g, "")
    .trim();
  const parts = sentences(clean, done);
  // Reserve the third sentence for a late warning; emitted prefixes never change.
  const first = parts.slice(0, 2);
  if (!done && parts.length < 2) {
    let position = 0;
    for (const part of parts) position = clean.indexOf(part,position) + part.length;
    const tail = clean.slice(position).trimStart();
    const units = ttsUnits(tail,false);
    let end = 0;
    for (const unit of units) end = tail.indexOf(unit,end) + unit.length;
    if (end) first.push(tail.slice(0,end));
  }
  if (done && parts.length > 2)
    first.push(
      parts.slice(2).find((p) => /주의|경고|위험|금지|반드시|하지 마|안전/.test(p)) ?? parts[2],
    );
  return first.join(" ") || (done && full.trim() ? "자세한 내용은 화면에서 확인해 주세요." : "");
}
