import { useState } from "react";
import { MAX_EDITED_LYRICS, type MusicRecord } from "@/lib/music-model";

export function LyricsEditor({ music, original, onUpdate }: {
  music: MusicRecord;
  original?: string;
  onUpdate: (record: MusicRecord) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const saved = music.editedLyrics;
  const source = saved?.original ?? original;
  if (source === undefined) return null;
  const value = saved?.text ?? source;
  function start() {
    setDraft(value);
    setEditing(true);
    setNotice("");
  }
  async function save() {
    if (draft.length > MAX_EDITED_LYRICS || source === undefined || source.length > MAX_EDITED_LYRICS) return;
    setSaving(true);
    setNotice("수정본을 기기에 저장하는 중입니다.");
    try {
      await onUpdate({ ...music, editedLyrics: {
        original: source, text: draft, updatedAt: new Date().toISOString(),
        partial: saved?.partial ?? music.state === "CANCELLED",
      } });
      setEditing(false);
      setNotice("수정본을 이 기기의 대화 기록에 저장했습니다. 대화 백업에도 포함됩니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "수정본을 기기에 저장하지 못했습니다. 다시 저장해 주세요.");
    } finally { setSaving(false); }
  }
  function download(text: string, suffix: string) {
    const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `lyrics-${music.jobId ?? music.request.requestId}-${suffix}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setNotice("UTF-8 TXT 다운로드를 요청했습니다. 저장한 내용만 내려받습니다.");
  }
  const button = "min-h-11 rounded-xl border border-line px-3 text-sm disabled:opacity-50";
  return <div className="space-y-3 rounded-xl border border-line p-3" aria-label="가사 수정·저장">
    <p className="text-sm text-muted">AI 원문은 보존합니다. 수정본은 이 기기와 대화 백업에 저장되며 NAS 원문에는 반영되지 않습니다.</p>
    {saved ? <div className="space-y-2">
      <p className="font-medium">사용자 수정본</p>
      <p className="whitespace-pre-wrap break-words text-sm">{saved.text || "빈 가사로 저장했습니다."}</p>
      <p className="text-xs text-muted">{new Date(saved.updatedAt).toLocaleString("ko-KR")} 저장</p>
      {saved.partial ? <p className="text-sm text-muted">취소된 작업의 일부 원문을 바탕으로 수정했습니다.</p> : null}
    </div> : null}
    {original === undefined ? <details>
      <summary className="min-h-11 cursor-pointer text-sm">보관한 AI 인식 원문</summary>
      <p className="whitespace-pre-wrap break-words text-sm">{source || "원문에 받아쓴 가사가 없습니다."}</p>
    </details> : null}
    {editing ? <div className="space-y-2">
      <label className="block text-sm">수정할 가사
        <textarea aria-label="수정할 가사" disabled={saving} className="mt-2 min-h-48 w-full rounded-xl border border-line bg-bg p-3 text-fg" value={draft} maxLength={MAX_EDITED_LYRICS} onChange={event => setDraft(event.target.value)} />
      </label>
      <p className="text-xs text-muted">{draft.length.toLocaleString()} / {MAX_EDITED_LYRICS.toLocaleString()}자 · 저장 전 변경은 임시 상태입니다.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving} className="min-h-11 rounded-xl bg-primary px-3 text-sm text-ink disabled:opacity-50" onClick={() => void save()}>{saving ? "수정본 저장 중…" : "수정본 저장"}</button>
        <button type="button" disabled={saving} className={button} onClick={() => { setEditing(false); setNotice("임시 변경을 취소했습니다. 저장본은 유지됩니다."); }}>편집 취소</button>
        <button type="button" disabled={saving} className={button} onClick={() => setDraft(source)}>AI 원문으로 채우기</button>
      </div>
    </div> : <button type="button" className={button} disabled={source.length > MAX_EDITED_LYRICS} onClick={start}>가사 수정</button>}
    {source.length > MAX_EDITED_LYRICS ? <p role="status" className="text-sm text-muted">원문이 60,000자를 초과해 수정 저장을 지원하지 않습니다. 원문 TXT는 내려받을 수 있습니다.</p> : null}
    <div className="flex flex-wrap gap-2">
      {saved ? <button type="button" className={button} onClick={() => download(saved.text, "edited")}>수정본 TXT 다운로드</button> : null}
      <button type="button" className={button} onClick={() => download(source, "original")}>AI 원문 TXT 다운로드</button>
    </div>
    {notice ? <p role="status" className="text-sm text-muted">{notice}</p> : null}
  </div>;
}
