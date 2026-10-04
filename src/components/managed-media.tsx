import { useEffect, useState } from "react";
import { getMedia, readMediaBlob, MEDIA_CHANGED } from "@/lib/media-repository";

export function ManagedMedia({
  id,
  fallback,
  type,
  alt,
}: {
  id?: string;
  fallback?: string;
  type: "image" | "video" | "voice" | "audio" | "music";
  alt?: string;
}) {
  const [url, setUrl] = useState(""),
    [status, setStatus] = useState("원본을 불러오는 중…");
  useEffect(() => {
    let stopped = false,
      owned = "";
    async function load() {
      if (owned) {
        URL.revokeObjectURL(owned);
        owned = "";
      }
      setUrl("");
      if (!id) {
        if (fallback && !fallback.startsWith("media:")) {
          setUrl(fallback);
          setStatus("링크 원본 · 로컬 저장 미확인");
        } else setStatus("원본 파일 없음 · 백업에서 복원하세요.");
        return;
      }
      try {
        const item = await getMedia(id);
        if (item?.lifecycle === "deleted") {
          setStatus("기록은 있지만 원본은 삭제되었습니다.");
          return;
        }
        if (item?.lifecycle === "trashed") {
          setStatus("앱 휴지통에 있습니다. 라이브러리에서 복원하세요.");
          return;
        }
        const blob = await readMediaBlob(id);
        if (stopped) return;
        if (blob) {
          owned = URL.createObjectURL(blob);
          setUrl(owned);
          setStatus("");
        } else {
          setStatus(item?.error ?? "로컬 원본 없음 · 백업에서 복원하세요.");
        }
      } catch (e) {
        if (!stopped) setStatus(e instanceof Error ? e.message : "원본을 열지 못했습니다.");
      }
    }
    void load();
    const refresh = () => void load();
    window.addEventListener(MEDIA_CHANGED, refresh);
    return () => {
      stopped = true;
      window.removeEventListener(MEDIA_CHANGED, refresh);
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [id, fallback]);
  return (
    <div className="mt-3 space-y-2">
      {url ? (
        type === "image" ? (
          <img src={url} alt={alt ?? "저장한 사진"} className="w-full rounded-2xl bg-bg" />
        ) : type === "video" ? (
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            className="w-full rounded-2xl bg-bg"
          />
        ) : (
          <audio src={url} controls preload="none" className="w-full" />
        )
      ) : null}
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </div>
  );
}
