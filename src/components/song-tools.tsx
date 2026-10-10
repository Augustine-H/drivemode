import { useEffect, useRef, useState } from "react";
import { connection, submitMusic, authorizeMusicRequest, musicHealth, MUSIC_CONNECTION_CHANGED } from "@/lib/music-client";
import { songRequest, singingLanguages, type SingingLanguage, type MusicRecord, type MusicRequest } from "@/lib/music-model";
import { recognitionLanguages, type TranscriptionLanguage } from "@/lib/recognition-languages";
import { transcriptionProviders, estimatedTranscriptionCost, type TranscriptionProvider, type PaidPricing } from "@/lib/transcription-providers";
import { singingLyricsGuidance } from "@/lib/singing-lyrics-guidance";

async function sampleWav(file: File, fullFile = false) {
  if (file.size > 32 * 1024 * 1024) throw new Error("32MB 이하의 오디오 파일을 선택하세요.");
  const context = new AudioContext();
  try {
    const source = await context.decodeAudioData(await file.arrayBuffer());
    if (source.duration < 1) throw new Error("1초 이상의 오디오가 필요합니다.");
    if (fullFile && source.duration > 600) throw new Error("파일 전체 받아쓰기는 10분 이하의 음원을 선택하세요.");
    const frames = Math.min((fullFile ? 600 : 30) * 16000, Math.floor(source.duration * 16000));
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
    const audioBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("오디오 변환 결과를 읽지 못했습니다."));
      reader.readAsDataURL(new Blob([bytes], { type: "audio/wav" }));
    });
    return { audioBase64, duration: Math.ceil(frames / 16000) };
  } finally { await context.close(); }
}

export function SongTools({ onRecover, personaVoice, personaName }: { onRecover: (record: MusicRecord) => void; personaVoice?: string; personaName?: string }) {
  const [personaSinging, setPersonaSinging] = useState(false);
  const [singingVoices, setSingingVoices] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("따뜻한 피아노 팝"), [lyrics, setLyrics] = useState("");
  const [singingLanguage, setSingingLanguage] = useState<SingingLanguage>("ko");
  const [supportedSingingLanguages, setSupportedSingingLanguages] = useState<string[]>(["ko"]);
  const [duration, setDuration] = useState(30), [file, setFile] = useState<File>();
  const [identify, setIdentify] = useState(false), [transcribe, setTranscribe] = useState(true);
  const [language, setLanguage] = useState<TranscriptionLanguage>("ko");
  const [provider, setProvider] = useState<TranscriptionProvider>("qwen"), [paidConsent, setPaidConsent] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<string[]>(["qwen"]), [pricing, setPricing] = useState<PaidPricing>();
  const [fileSeconds, setFileSeconds] = useState<number>();
  const [generationProvider, setGenerationProvider] = useState<"local" | "elevenlabs">("local");
  const [generationConsent, setGenerationConsent] = useState(false);
  const lyricsGuidance = singingLyricsGuidance(lyrics, duration, singingLanguage, generationProvider);
  const [generationProviders, setGenerationProviders] = useState<string[]>(["local"]);
  const [generationPricing, setGenerationPricing] = useState<{ estimatedUsdPerMinute: number; checkedAt: string }>();
  const [supportedLanguages, setSupportedLanguages] = useState<string[]>([]);
  const [fullFile, setFullFile] = useState(true), [fullFileLimit, setFullFileLimit] = useState(0);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [recording, setRecording] = useState(false), [preview, setPreview] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [device, setDevice] = useState("");
  const [microphone, setMicrophone] = useState(""), [level, setLevel] = useState(-100), [peak, setPeak] = useState(-100);
  const [elapsed, setElapsed] = useState(0), [trackMuted, setTrackMuted] = useState(false);
  const meter = useRef<{ context: AudioContext; interval: ReturnType<typeof setInterval> } | undefined>(undefined);
  const [serviceReady, setServiceReady] = useState(false), [serviceNotice, setServiceNotice] = useState("NAS 지원 여부 확인 중…");
  const recorder = useRef<MediaRecorder | undefined>(undefined), mounted = useRef(true);
  function stopMeter() {
    if (!meter.current) return;
    clearInterval(meter.current.interval);
    void meter.current.context.close().catch(() => {});
    meter.current = undefined;
  }
  async function refreshDevices() {
    try {
      const inputs = (await navigator.mediaDevices?.enumerateDevices())?.filter(d => d.kind === "audioinput") ?? [];
      if (mounted.current) setDevices(inputs);
    } catch { if (mounted.current) setNotice("마이크 목록을 읽지 못했습니다. 브라우저 권한을 확인하세요."); }
  }
  useEffect(() => {
    mounted.current = true;
    void refreshDevices();
    const changed = () => { void refreshDevices(); };
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => {
      mounted.current = false;
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
      stopMeter();
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
        setSupportedLanguages(h.transcriptionLanguages ?? []);
        setAvailableProviders(h.transcriptionProviders ?? ["qwen"]);
        setPricing(h.paidTranscriptionPricing);
        setGenerationProviders(h.generationProviders ?? ["local"]);
        setSingingVoices(h.singingVoices ?? []);
        setSupportedSingingLanguages(h.singingLanguages ?? ["ko"]);
        setGenerationPricing(h.paidGenerationPricing);
        setFullFileLimit(h.fullFileTranscriptionMaxSeconds ?? 0);
        setServiceNotice(ready ? "" : "NAS에 보컬·인식 업데이트를 적용한 뒤 사용할 수 있습니다.");
      } catch (error) {
        if (!stopped) { setServiceReady(false); setSingingVoices([]); setSupportedLanguages([]); setFullFileLimit(0); setServiceNotice(error instanceof Error ? error.message : "NAS 지원 확인 실패"); }
      }
    }
    void check(); window.addEventListener(MUSIC_CONNECTION_CHANGED, check);
    return () => { stopped = true; window.removeEventListener(MUSIC_CONNECTION_CHANGED, check); };
  }, []);
  useEffect(() => { setGenerationConsent(false); }, [prompt, lyrics, duration, generationProvider, singingLanguage]);
  useEffect(() => { setPersonaSinging(false); }, [personaVoice, generationProvider]);
  useEffect(() => {
    setFileSeconds(undefined); setPaidConsent(false);
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        ...(device ? { deviceId: { exact: device } } : {}),
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      } });
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return; }
      void refreshDevices();
      const track = stream.getAudioTracks()[0];
      setMicrophone(track.label || "이름을 확인할 수 없는 마이크");
      setLevel(-100); setPeak(-100); setElapsed(0); setTrackMuted(track.muted);
      const context = new AudioContext();
      // Zero gain keeps the meter processing without feeding the microphone to speakers.
      const analyser = context.createAnalyser(), source = context.createMediaStreamSource(stream), silent = context.createGain();
      analyser.fftSize = 2048; silent.gain.value = 0;
      source.connect(analyser); analyser.connect(silent); silent.connect(context.destination);
      const pcm = new Float32Array(analyser.fftSize), startedAt = performance.now();
      let peakDb = -100;
      const interval = setInterval(() => {
        analyser.getFloatTimeDomainData(pcm);
        const rms = Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length);
        const db = Math.max(-100, 20 * Math.log10(Math.max(rms, 0.00001)));
        peakDb = Math.max(peakDb, db);
        if (mounted.current) { setLevel(db); setPeak(peakDb); setElapsed(Math.min(30, Math.floor((performance.now() - startedAt) / 1000))); setTrackMuted(track.muted); }
      }, 150);
      meter.current = { context, interval };
      void context.resume().catch(() => { if (mounted.current) setNotice("입력 음량 표시를 시작하지 못했습니다. 녹음 미리 듣기로 확인하세요."); });
      const current = new MediaRecorder(stream), chunks: BlobPart[] = [];
      recorder.current = current;
      const timer = setTimeout(() => { if (current.state !== "inactive") current.stop(); }, 30000);
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onstop = () => {
        clearTimeout(timer); current.stream.getTracks().forEach(track => track.stop());
        stopMeter();
        if (mounted.current) {
          setRecording(false);
          if (chunks.length) setFile(new File(chunks, "마이크-노래-샘플", { type: current.mimeType || "audio/webm" }));
          if (peakDb < -60) setNotice("마이크에 소리가 거의 들어오지 않았습니다. 입력 장치·음소거·마이크 위치를 확인하고 다시 녹음하세요.");
        }
      };
      current.onerror = () => {
        current.stream.getTracks().forEach(track => track.stop());
        if (current.state !== "inactive") current.stop();
        if (mounted.current) setNotice("마이크 녹음이 실패했습니다. 파일을 선택하거나 다시 시도하세요.");
      };
      current.start(); setRecording(true);
    } catch (error) {
      stopMeter();
      stream?.getTracks().forEach(track => track.stop());
      if (mounted.current) setNotice(error instanceof Error ? error.message : "마이크 연결 실패");
    } finally { if (mounted.current) setBusy(false); }
  }
  const input = "min-h-11 w-full rounded-xl border border-line bg-bg p-3 text-fg";
  async function submit(make: () => Promise<MusicRequest>) {
    setBusy(true); setNotice("");
    try {
      const c = await connection(), request = await make();
      if (request.kind !== "recognition") {
        authorizeMusicRequest(request.requestId);
        onRecover({ source: c.url, request, state: "QUEUED" });
        return;
      }
      // Preserve only the request ID across an ambiguous network failure. A
      // reselected identical sample reuses it; raw audio is never persisted here.
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request.audioBase64)));
      const sampleHash = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
      const pendingKey = `voice-grok-recognition-pending:${c.url}:${sampleHash}:${request.identify}:${request.transcribe}:${request.transcriptionLanguage ?? "ko"}:${request.fullFile ?? false}:${request.transcriptionProvider ?? "qwen"}`;
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
  const paid = transcribe && provider !== "qwen";
  const estimatedSeconds = Math.min(fileSeconds ?? (fullFile ? 600 : 30), fullFile ? 600 : 30);
  const estimatedCost = estimatedTranscriptionCost(provider, estimatedSeconds, pricing);
  const paidGeneration = generationProvider === "elevenlabs";
  const generationCost = generationPricing ? duration / 60 * generationPricing.estimatedUsdPerMinute : undefined;
  const generationBlocked = busy || !serviceReady || (paidGeneration && (!generationConsent || !generationProviders.includes("elevenlabs") || generationCost === undefined));
  function generationRequest(song: boolean): MusicRequest {
    const request = songRequest(prompt, song ? lyrics : "instrumental", duration, `generation-${crypto.randomUUID()}`, singingLanguage);
    if (!song) { delete request.kind; delete request.lyrics; delete request.singingLanguage; }
    if (song && !supportedSingingLanguages.includes(singingLanguage)) throw new Error("선택한 보컬 언어를 사용하려면 NAS와 Worker 업데이트가 필요합니다.");
    if (paidGeneration && song && lyrics.length > 4000) throw new Error("유료 보컬 가사는 4,000자 이내로 입력하세요.");
    if (song && personaSinging && (!personaVoice || !singingVoices.includes(personaVoice))) throw new Error("선택한 페르소나 가창 목소리가 준비되지 않았습니다.");
    return { ...request, generationProvider, ...(paidGeneration ? { paidGenerationConsent: true } : {}),
      ...(song && personaSinging ? { singingVoice: personaVoice, singingMethod: "persona_seed_vc" as const } : {}) };
  }
  return <div className="space-y-4 border-t border-line pt-4">
    {serviceNotice ? <p role="status" className="text-muted">{serviceNotice}</p> : null}
    <details><summary className="min-h-11 cursor-pointer font-medium">음악·보컬 생성 모델 선택</summary>
      <div className="mt-3 space-y-3">
        <label className="block">생성 모델<select aria-label="음악 생성 모델" className={input} disabled={busy} value={generationProvider} onChange={e => setGenerationProvider(e.target.value as "local" | "elevenlabs")}>
          <option value="local">로컬 · API 비용 없음</option>
          <option value="elevenlabs" disabled={!generationProviders.includes("elevenlabs")}>ElevenLabs · Music v2.5{generationProviders.includes("elevenlabs") ? "" : " · NAS 업데이트 또는 키 연결 필요"}</option>
        </select></label>
        {paidGeneration ? <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-muted">{duration}초 기준 예상 {generationCost === undefined ? "비용 확인 불가" : `$${generationCost.toFixed(3)}`}. {generationPricing?.checkedAt} 표시 단가이며 계정 요금제·실제 청구액과 다를 수 있습니다. 음악 API 권한은 키 등록과 별개입니다.</p>
          <p className="text-muted">곡 설명과 가사를 ElevenLabs에 한 번 전송합니다. 실패 시 자동 재시도·유료 전환을 하지 않습니다. 전송 후 취소해도 비용이 발생할 수 있습니다. WAV는 공급자 MP3를 디코딩한 파일입니다.</p>
          <label className="flex min-h-11 items-start gap-2"><input aria-label="유료 음악 생성 동의" type="checkbox" checked={generationConsent} disabled={busy} onChange={e => setGenerationConsent(e.target.checked)}/>설명·직접 쓴 가사를 전송하고 유료 생성하는 데 동의합니다.</label>
        </div> : <p className="text-muted">연주곡은 Stable Audio, 보컬은 ACE-Step으로 PC에서 생성합니다. 채팅·음성 명령은 계속 로컬 모델을 사용합니다.</p>}
      </div>
    </details>
    <details><summary className="min-h-11 cursor-pointer font-medium">연주곡 만들기</summary>
      <div className="mt-3 space-y-3">
        <label className="block">곡 분위기<input aria-label="연주곡 분위기" className={input} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={2000}/></label>
        <label className="block">길이 (10~120초)<input aria-label="연주곡 길이" type="number" min={10} max={120} className={input} value={duration} onChange={e => setDuration(Number(e.target.value))}/></label>
        <button className="min-h-11 rounded-xl bg-primary px-4 text-ink disabled:opacity-50" disabled={generationBlocked || !prompt.trim()} onClick={() => void submit(async () => generationRequest(false))}>연주곡 생성</button>
      </div>
    </details>
    <details><summary className="min-h-11 cursor-pointer font-medium">보컬 노래 만들기</summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted">직접 쓴 가사로 새 노래를 만듭니다. 가사에 맞는 언어를 선택하세요. 특정 가수의 목소리를 복제하지 않습니다.</p>
        <label className="block">보컬 언어<select aria-label="보컬 언어" className={input} disabled={busy} value={singingLanguage} onChange={e => setSingingLanguage(e.target.value as SingingLanguage)}>
          {singingLanguages.map(item => <option key={item.code} value={item.code} disabled={!supportedSingingLanguages.includes(item.code)}>{item.label}{!supportedSingingLanguages.includes(item.code) ? " · 서버 업데이트 필요" : ""}</option>)}
        </select></label>
        <div className="space-y-2 rounded-xl border border-line p-3">
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" aria-label="페르소나 목소리로 노래" disabled={busy || !personaVoice || !singingVoices.includes(personaVoice)} checked={personaSinging} onChange={e => setPersonaSinging(e.target.checked)}/>{personaName ?? "현재 페르소나"}의 목소리로 노래 · 로컬 음색 변환</label>
          <p className="text-muted">{personaVoice && singingVoices.includes(personaVoice) ? "xAI 목소리를 기준으로 보컬 음색을 변환합니다. 추가 처리 시간이 필요하며 곡과 음역에 따라 유사성이 달라질 수 있습니다." : "이 페르소나의 가창 목소리가 준비되지 않았거나 NAS 업데이트가 필요합니다. 다른 목소리로 자동 대체하지 않습니다."}</p>
          {paidGeneration && <p className="text-muted">ElevenLabs에서 유료 원곡을 만든 뒤 PC에서 목소리를 변환합니다. 페르소나 참조 음성은 ElevenLabs에 전송하지 않습니다.</p>}
        </div>
        <label className="block">곡 분위기<input aria-label="보컬 곡 분위기" className={input} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={2000}/></label>
        <label className="block">가사<textarea aria-label="노래 가사" className={input + " min-h-32"} value={lyrics} onChange={e => setLyrics(e.target.value)} maxLength={8000} placeholder={"[Verse]\n여기에 직접 쓴 가사를 입력하세요\n[Chorus]\n후렴 가사"}/></label>
        <label className="block">길이 (10~120초)<input aria-label="보컬 노래 길이" type="number" min={10} max={120} className={input} value={duration} onChange={e => setDuration(Number(e.target.value))}/></label>
        {lyricsGuidance && <div className="space-y-2 rounded-xl border border-line p-3" aria-label="가사 분량 안내">
          <p className="font-medium">{lyricsGuidance.message}</p>
          <p className="text-muted">{lyricsGuidance.advice}</p>
          {lyricsGuidance.crowded && <p className="text-muted">가사를 줄이거나 곡 길이를 늘려 비교해 보세요. 입력한 가사는 그대로 전달됩니다.</p>}
        </div>}
        <button className="min-h-11 rounded-xl bg-primary px-4 text-ink disabled:opacity-50" disabled={generationBlocked || !supportedSingingLanguages.includes(singingLanguage) || !lyrics.trim() || (personaSinging && (!personaVoice || !singingVoices.includes(personaVoice)))} onClick={() => void submit(async () => generationRequest(true))}>보컬 노래 생성</button>
      </div>
    </details>
    <details><summary className="min-h-11 cursor-pointer font-medium">노래 제목·가수 찾기 / 가사 받아쓰기</summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted">가사는 파일 전체(최대 10분·32MB)를 받아쓸 수 있습니다. 마이크 녹음과 제목·가수 검색은 처음 30초를 사용합니다. 음원은 개인 NAS를 거쳐 Windows에서 처리하고 처리 후 입력 음원을 삭제합니다. 반주나 발음에 따라 오류가 생길 수 있습니다.</p>
        <input className={input} aria-label="인식할 노래 파일" type="file" accept="audio/*" disabled={recording || busy} onChange={e => setFile(e.target.files?.[0])}/>
        <label className="block">녹음 마이크<select aria-label="녹음 마이크" className={input} disabled={recording || busy} value={device} onChange={e => setDevice(e.target.value)}>
          <option value="">Windows 기본 입력 장치</option>
          {devices.filter(d => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications").map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `마이크 ${i + 1}`}</option>)}
        </select></label>
        <button className="min-h-11 rounded-xl border border-line px-4 disabled:opacity-50" disabled={recording || busy} onClick={() => void refreshDevices()}>마이크 목록 새로 확인</button>
        <button className="min-h-11 rounded-xl border border-line px-4 disabled:opacity-50" disabled={busy} onClick={() => void record()}>{recording ? "녹음 종료" : "마이크로 30초 녹음"}</button>
        {recording ? <p role="status">녹음 중… 30초 후 자동 종료합니다. ‘노래 인식’을 누르기 전에는 전송하지 않습니다.</p> : null}
        {microphone ? <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="break-words text-muted">{recording ? "녹음 중인" : "마지막 녹음"} 장치: {microphone}</p>
          <meter aria-label="마이크 입력 음량" className="h-3 w-full" min={-100} max={0} low={-60} high={-12} optimum={-20} value={level}/>
          <p className="text-muted">{elapsed} / 30초 · 입력 {Math.round(level)} dBFS · 최대 {Math.round(peak)} dBFS</p>
          {recording ? <p role="status">{trackMuted ? "브라우저의 마이크 입력이 음소거 상태입니다." : level < -60 ? "소리가 거의 없습니다. 휴대폰을 마이크 가까이 놓고 음량 막대가 움직이는지 확인하세요." : "마이크에 소리가 들어오고 있습니다."}</p> : null}
        </div> : null}
        {file ? <p className="break-words text-muted">선택한 샘플: {file.name}</p> : null}
        {preview ? <audio aria-label="인식 샘플 미리 듣기" className="w-full max-w-full" controls src={preview} onLoadedMetadata={e => { const seconds = e.currentTarget.duration; if (Number.isFinite(seconds) && seconds > 0) setFileSeconds(seconds); }}/> : null}
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy || recording} checked={transcribe} onChange={e => setTranscribe(e.target.checked)}/>가사 받아쓰기</label>
        {transcribe ? <div className="space-y-2">
          <label className="block">받아쓰기 모델<select aria-label="받아쓰기 모델" className={input} disabled={busy || recording} value={provider} onChange={e => { setProvider(e.target.value as TranscriptionProvider); setPaidConsent(false); }}>
            {transcriptionProviders.map(([id, label]) => <option key={id} value={id} disabled={!availableProviders.includes(id)}>{label}{availableProviders.includes(id) ? "" : " · 연결되지 않음"}</option>)}
          </select></label>
          {paid ? <div className="space-y-2 rounded-xl border border-line p-3">
            <p className="text-muted">{fileSeconds ? "선택 구간" : "최대 길이"} {Math.ceil(estimatedSeconds)}초 기준 예상 비용: {estimatedCost === undefined ? "확인할 수 없음" : `약 $${estimatedCost.toFixed(5)}`}. {pricing?.checkedAt} 표시 단가 기준이며 실제 청구액·계정 요금제와 다를 수 있습니다.</p>
            <p className="text-muted">선택한 공급자에 음원 파일을 전송합니다. 파일 전체는 한 요청으로 처리합니다. 실패하거나 응답이 불확실해도 자동 재시도·다른 모델 전환은 하지 않습니다. 전송 후 취소해도 비용이 발생할 수 있습니다.</p>
            <label className="flex min-h-11 items-start gap-2"><input type="checkbox" aria-label="유료 음원 전송 동의" disabled={busy || recording} checked={paidConsent} onChange={e => setPaidConsent(e.target.checked)}/>선택한 공급자에 음원을 전송하고 유료 받아쓰기를 실행하는 데 동의합니다.</label>
          </div> : <p className="text-muted">개인 Windows에서 처리합니다. 받아쓰기 API 비용이 없습니다.</p>}
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy || recording} checked={fullFile} onChange={e => setFullFile(e.target.checked)}/>파일 전체 받아쓰기</label>
          <p className="text-muted">{fullFile ? paid ? "파일 전체를 선택한 API에 한 번 전송합니다. 최대 10분이며 접수 후 화면을 닫아도 처리는 계속됩니다." : "겹치는 구간으로 나눠 인식한 뒤 가사를 합칩니다. 접수 후 화면을 닫아도 처리는 계속됩니다. 취소하면 진행 중인 구간을 마친 뒤 중단합니다." : "처음 30초만 받아씁니다."}</p>
          {fullFile && fullFileLimit < 600 ? <p role="status" className="text-muted">NAS 음악 API의 전체 파일 업데이트가 필요합니다. 처음 30초 인식은 전체 받아쓰기를 해제하면 사용할 수 있습니다.</p> : null}
          <label className="block">가사 언어<select aria-label="가사 언어" className={input} disabled={busy || recording} value={language} onChange={e => setLanguage(e.target.value as TranscriptionLanguage)}>
            {recognitionLanguages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select></label>
          <p className="text-muted">곡의 언어를 알면 직접 선택하세요. 자동 감지는 짧은 구간이나 여러 언어가 섞인 노래에서 틀릴 수 있습니다.</p>
          {language !== "ko" && !supportedLanguages.includes(language) ? <p role="status" className="text-muted">NAS 음악 API의 외국어 업데이트가 필요합니다.</p> : null}
        </div> : null}
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy || recording} checked={identify} onChange={e => setIdentify(e.target.checked)}/>제목·가수 찾기</label>
        {identify ? <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>곡 검색용 오디오 지문을 Shazam에 전송하는 데 동의합니다. 비공식 연결이므로 검색 실패·서비스 중단이 발생할 수 있습니다.</label> : null}
        <button className="min-h-11 rounded-xl bg-primary px-4 text-ink disabled:opacity-50" disabled={busy || !serviceReady || recording || !file || !(identify || transcribe) || (identify && !consent) || (paid && (!paidConsent || estimatedCost === undefined || !availableProviders.includes(provider))) || (transcribe && fullFile && fullFileLimit < 600) || (transcribe && language !== "ko" && !supportedLanguages.includes(language))} onClick={() => void submit(async () => ({ requestId: `recognition-${crypto.randomUUID()}`, prompt: "노래 인식", kind: "recognition", seed: 1042, bitrate: 320, identify, transcribe, ...(transcribe ? { transcriptionProvider: provider } : {}), ...(paid ? { paidAudioConsent: paidConsent } : {}), ...(transcribe && fullFile ? { fullFile: true } : {}), ...(transcribe && supportedLanguages.includes(language) ? { transcriptionLanguage: language } : {}), fingerprintConsent: identify && consent, ...await sampleWav(file!, transcribe && fullFile) }))}>선택한 노래 인식</button>
      </div>
    </details>
    {busy ? <p role="status">준비·접수 중…</p> : null}
    {notice ? <p role="alert" className="break-words text-muted">{notice}</p> : null}
  </div>;
}
