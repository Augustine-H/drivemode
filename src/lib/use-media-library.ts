import { useCallback, useEffect, useState } from "react";
import type { Turn } from "./transcript";
import {
  MEDIA_CHANGED,
  getMedia,
  ingestMedia,
  linkMedia,
  listMedia,
  recoverMediaJobs,
  maintainMedia,
  getMediaPolicy,
} from "./media-repository";
import { mediaGet, mediaPut, withMediaLock } from "./media-db";
import { newMedia, type MediaItem } from "./media-model";
import { sha256 } from "./media-storage";
export function useMediaLibrary(
  threads: Record<string, Turn[]>,
  hydrated: boolean,
  onMigrate: (room: string, id: string, mediaId: string) => void,
) {
  const [items, setItems] = useState<MediaItem[]>([]),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setItems(await listMedia());
    } catch (e) {
      setError(e instanceof Error ? e.message : "미디어 저장소 오류");
    }
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    void recoverMediaJobs()
      .then(() => maintainMedia())
      .then(() => import("./voice-mail").then((m) => m.migrateVoiceMailMedia()))
      .then(refresh)
      .catch((e) => setError(String(e.message ?? e)));
    const changed = () => void refresh();
    const foreground = () => {
      if (!document.hidden)
        void maintainMedia()
          .then(refresh)
          .catch((e) => setError(String(e.message ?? e)));
    };
    window.addEventListener(MEDIA_CHANGED, changed);
    document.addEventListener("visibilitychange", foreground);
    const timer = setInterval(foreground, 60000);
    const channel =
      typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(MEDIA_CHANGED) : undefined;
    channel?.addEventListener("message", changed);
    return () => {
      clearInterval(timer);
      window.removeEventListener(MEDIA_CHANGED, changed);
      document.removeEventListener("visibilitychange", foreground);
      channel?.close();
    };
  }, [hydrated, refresh]);
  useEffect(() => {
    if (!hydrated) return;
    let stopped = false;
    void (async () => {
      for (const [room, list] of Object.entries(threads))
        for (const turn of list) {
          if (stopped) return;
          if (turn.mediaIds?.length) {
            for (const id of turn.mediaIds)
              await linkMedia(id, {
                conversationId: room,
                messageId: turn.id,
                personaId: turn.personaId ?? room,
              });
            continue;
          }
          const url = turn.image ?? turn.video;
          if (!url || url.startsWith("media:")) continue;
          const id = "legacy-" + (await sha256(new Blob([url]))).slice(0, 48);
          if (!(await getMedia(id))) {
            if (url.startsWith("data:") || url.startsWith("blob:"))
              await ingestMedia({
                id,
                type: turn.video ? "video" : "image",
                origin: "legacy",
                url,
                description: turn.mediaDescription,
                personaId: turn.personaId ?? room,
                createdAt: turn.at,
                refs: [
                  { conversationId: room, messageId: turn.id, personaId: turn.personaId ?? room },
                ],
              });
            else
              await withMediaLock(async () => {
                if (await getMedia(id)) return;
                const item = newMedia(
                  {
                    id,
                    type: turn.video ? "video" : "image",
                    origin: "legacy",
                    remoteUrl: url,
                    description: turn.mediaDescription,
                    createdAt: turn.at,
                    personaId: turn.personaId ?? room,
                    refs: [
                      {
                        conversationId: room,
                        messageId: turn.id,
                        personaId: turn.personaId ?? room,
                      },
                    ],
                  },
                  await getMediaPolicy(),
                );
                await mediaPut("index", id, {
                  ...item,
                  availability: "remote-only",
                  ingestState: "failed",
                  error: "기존 URL 기록입니다. 원본 재시도로 로컬 파일을 확보하세요.",
                });
              });
          } else
            await linkMedia(id, {
              conversationId: room,
              messageId: turn.id,
              personaId: turn.personaId ?? room,
            });
          await mediaPut("settings", "migration-checkpoint", {
            room,
            messageId: turn.id,
            at: Date.now(),
          });
          if (!stopped) onMigrate(room, turn.id, id);
        }
      await refresh();
    })().catch((e) => {
      if (!stopped) setError(String(e.message ?? e));
    });
    return () => {
      stopped = true;
    };
  }, [threads, hydrated, onMigrate, refresh]);
  return { items, error, refresh };
}
export async function deviceId() {
  let id = await mediaGet<string>("settings", "deviceId");
  if (!id) {
    id = crypto.randomUUID();
    await mediaPut("settings", "deviceId", id);
  }
  return id;
}
