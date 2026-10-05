import { useEffect, useRef, useState } from "react";
import { connection, submitMusic, authorizeMusicRequest, musicHealth, MUSIC_CONNECTION_CHANGED } from "@/lib/music-client";
import { songRequest, type MusicRecord, type MusicRequest } from "@/lib/music-model";

async function sampleWav(file: File) {
  if (file.size > 32 * 1024 * 1024) throw new Error("32MB 이하의 오디오 파일을 선택하세요.");
  const context = new AudioContext();
  try {
    const source = await context.decodeAudioData(await file.arrayBuffer());
    if (source.duration < 1) throw new Error("1초 이상의 오디오가 필요합니다.");
    const frames = Math.min(30 * 16000, Math.floor(source.duration * 16000));
    const offline = new OfflineAudioContext(1, frames, 16000);
    const node = offline.createBufferSource();
    node.buffer = source;
    node.connect(offline.destination);
    node.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    const bytes = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(bytes);
    const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVEfmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, pcm.length * 2, true);
    pcm.forEach((v, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, v)) * 32767), true));
    let binary = "";
    for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
    return { audioBase64: btoa(binary), duration: Math.ceil(frames / 16000) };
  } finally { await context.close(); }
}

export function SongTools({ onRecover }: { onRecover: (record: MusicRecord) => void }) {
  const [prompt, setPrompt] = useState("따뜻한 피아노 팝, 한국어 보컬"), [lyrics, setLyrics] = useState("");
  const [duration, setDuration] = useState(30), [file, setFile] = useState<File>();
  const [identify, setIdentify] = useState(false), [transcribe, setTranscribe] = useState(true);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [recording, setRecording] = useState(false), [preview, setPreview] = useState("");
  const [serviceReady, setServiceReady] = useState(false), [serviceNotice, setServiceNotice] = useState("NAS 지원 여부 확인 중…");
  const recorder = useRef<MediaRecorder | undefined>(undefined), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recorder.current?.stream.getTracks().forEach(track => track.stop());
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        const h = await musicHealth();
        if (stopped) return;
        const ready = h.supportedTasks?.includes("song") === true && h.supportedTasks.includes("recognition");
        setServiceReady(ready);
        setServiceNotice(ready ? "" : "NAS에 보컬·인식 업데이트를 적용한 뒤 사용할 수 있습니다.");
      } catch (error) {
        if (!stopped) { setServiceReady(false); setServiceNotice(error instanceof Error ? error.message : "NAS 지원 확인 실패"); }
      }
    }
    void check(); window.addEventListener(MUSIC_CONNECTION_CHANGED, check);
    return () => { stopped = true; window.removeEventListener(MUSIC_CONNECTION_CHANGED, check); };
  }, []);
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function record() {
    if (recording) { recorder.current?.stop(); return; }
    setNotice(""); setBusy(true);
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
        throw new Error("이 브라우저는 녹음을 지원하지 않습니다. 오디오 파일을 선택하세요.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const current = new MediaRecorder(stream), chunks: BlobPart[] = [];
      recorder.current = current;
      const timer = setTimeout(() => { if (current.state !== "inactive") current.stop(); }, 30000);
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onstop = () => {
        clearTimeout(timer); current.stream.getTracks().forEach(track => track.stop());
        if (mounted.current) {
          setRecording(false);
          if (chunks.length) setFile(new File(chunks, "마이크-노래-샘플", { type: current.mimeType || "audio/webm" }));
        }
      };
      current.onerror = () => {
        current.stream.getTracks().forEach(track => track.stop());
        if (current.state !== "inactive") current.stop();
        if (mounted.current) setNotice("마이크 녹음이 실패했습니다. 파일을 선택하거나 다시 시도하세요.");
      };
      current.start(); setRecording(true);
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (mounted.current) setNotice(error instanceof Error ? error.message : "마이크 연결 실패");
    } finally { if (mounted.current) setBusy(false); }
  }
  const input = "min-h-11 w-full rounded-xl border border-line bg-bg p-3 text-fg";
  async function submit(make: () => Promise<MusicRequest>) {
    setBusy(true); setNotice("");
    try {
      const c = await connection(), request = await make();
      if (request.kind === "song") {
        authorizeMusicRequest(request.requestId);
        onRecover({ source: c.url, request, state: "QUEUED" });
        return;
      }
      // Preserve only the request ID across an ambiguous network failure. A
      // reselected identical sample reuses it; raw audio is never persisted here.
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request.audioBase64)));
      const sampleHash = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
      const pendingKey = `voice-grok-recognition-pending:${c.url}:${sampleHash}:${request.identify}:${request.transcribe}`;
      const previous = sessionStorage.getItem(pendingKey);
      if (previous && /^[A-Za-z0-9_.:-]{1,100}$/.test(previous)) request.requestId = previous;
      sessionStorage.setItem(pendingKey, request.requestId);
      const job = await submitMusic(request);
      sessionStorage.removeItem(pendingKey);
      // Audio samples remain outside conversation backups; resume by job ID.
      const { audioBase64: _sample, ...metadata } = request;
      void _sample;
      onRecover({ source: c.url, request: metadata, jobId: job.id, state: job.state });
    } catch (e) { setNotice(e instanceof Error ? e.message : "요청 실패"); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <div className="space-y-4 border-t border-line pt-4">
    {serviceNotice ? <p role="status" className="text-muted">{serviceNotice}</p> : null}
    <details><summary className="min-h-11 cursor-pointer font-medium">보컬 노래 만들기</summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted">직접 쓴 한국어 가사로 새 노래를 만듭니다. 특정 가수의 목소리를 복제하지 않습니다.</p>
        <label className="block">곡 분위기<input aria-label="보컬 곡 분위기" className={input} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={2000}/></label>
        <label className="block">가사<textarea aria-label="노래 가사" className={input + " min-h-32"} value={lyrics} onChange={e => setLyrics(e.target.value)} maxLength={8000} placeholder={"[Verse]\n여기에 직접 쓴 가사를 입력하세요\n[Chorus]\n후렴 가사"}/></label>
        <label className="block">길이 (10~120초)<input aria-label="보컬 노래 길이" type="number" min={10} max={120} className={input} value={duration} onChange={e => setDuration(Number(e.target.value))}/></label>
        <button className="min-h-11 rounded-xl bg-primary px-4 text-ink disabled:opacity-50" disabled={busy || !serviceReady || !lyrics.trim()} onClick={() => void submit(async () => songRequest(prompt, lyrics, duration, `song-${crypto.randomUUID()}`))}>보컬 노래 생성</button>
      </div>
    </details>
    <details><summary className="min-h-11 cursor-pointer font-medium">노래 제목·가수 찾기 / 가사 받아쓰기</summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted">파일의 처음 30초 또는 마이크 녹음을 사용합니다. 샘플은 개인 NAS를 거쳐 Windows에서 처리하며, 처리 후 원본 샘플을 삭제합니다. 가사 받아쓰기는 로컬 Whisper를 사용합니다.</p>
        <input className={input} aria-label="인식할 노래 파일" type="file" accept="audio/*" disabled={recording || busy} onChange={e => setFile(e.target.files?.[0])}/>
        <button className="min-h-11 rounded-xl border border-line px-4 disabled:opacity-50" disabled={busy} onClick={() => void record()}>{recording ? "녹음 종료" : "마이크로 30초 녹음"}</button>
        {recording ? <p role="status">녹음 중… 30초 후 자동 종료합니다. ‘노래 인식’을 누르기 전에는 전송하지 않습니다.</p> : null}
        {file ? <p className="break-words text-muted">선택한 샘플: {file.name}</p> : null}
        {preview ? <audio aria-label="인식 샘플 미리 듣기" className="w-full max-w-full" controls src={preview}/> : null}
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={transcribe} onChange={e => setTranscribe(e.target.checked)}/>가사 받아쓰기</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={identify} onChange={e => setIdentify(e.target.checked)}/>제목·가수 찾기</label>
        {identify ? <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>곡 검색용 오디오 지문을 Shazam에 전송하는 데 동의합니다. 비공식 연결이므로 검색 실패·서비스 중단이 발생할 수 있습니다.</label> : null}
        <button className="min-h-11 rounded-xl bg-primary px-4 text-ink disabled:opacity-50" disabled={busy || !serviceReady || recording || !file || !(identify || transcribe) || (identify && !consent)} onClick={() => void submit(async () => ({ requestId: `recognition-${crypto.randomUUID()}`, prompt: "노래 인식", kind: "recognition", seed: 1042, bitrate: 320, identify, transcribe, fingerprintConsent: identify && consent, ...await sampleWav(file!) }))}>선택한 노래 인식</button>
      </div>
    </details>
    {busy ? <p role="status">준비·접수 중…</p> : null}
    {notice ? <p role="alert" className="break-words text-muted">{notice}</p> : null}
  </div>;
}
