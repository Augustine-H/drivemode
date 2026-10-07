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
  // Keep every completed sentence, then buffer only the unfinished tail.
  const first = [...parts];
  if (!done) {
    let position = 0;
    for (const part of parts) position = clean.indexOf(part,position) + part.length;
    const tail = clean.slice(position).trimStart();
    const units = ttsUnits(tail,false);
    let end = 0;
    for (const unit of units) end = tail.indexOf(unit,end) + unit.length;
    if (end) first.push(tail.slice(0,end));
  }
  return first.join(" ") || (done && full.trim() ? "자세한 내용은 화면에서 확인해 주세요." : "");
}
