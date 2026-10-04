import { useEffect, useState } from "react";
import { parseVoiceIdentity, VOICE_ID_KEY, type VoiceIdentity } from "./speaker-identity";
import { releaseSpeakerModel } from "./speaker-client";
export function useVoiceIdentity() {
  const [identity, setIdentity] = useState<VoiceIdentity | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(VOICE_ID_KEY);
      const saved = parseVoiceIdentity(raw);
      setIdentity(saved);
      if (raw && !saved) {
        setBlocked(true);
        setError(
          "등록 데이터가 손상되어 음성 입력을 차단했습니다. 다시 등록하거나 등록 목소리를 삭제하세요.",
        );
      }
    } catch {
      setError("등록한 목소리를 읽지 못했습니다.");
      setBlocked(true);
    }
    setReady(true);
    return () => releaseSpeakerModel();
  }, []);
  function save(value: VoiceIdentity | null) {
    try {
      if (value) localStorage.setItem(VOICE_ID_KEY, JSON.stringify(value));
      else localStorage.removeItem(VOICE_ID_KEY);
      if (value && localStorage.getItem(VOICE_ID_KEY) !== JSON.stringify(value)) throw Error();
      setIdentity(value);
      setBlocked(false);
      setError("");
    } catch {
      setError("목소리 설정을 저장하지 못했습니다.");
    }
  }
  return { identity, ready, error, blocked, save };
}
