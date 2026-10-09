import { allowedVideoSource } from "./video-source";
import { networkFetch } from './network.ts';
// Sample visual frames only; audio is not transcribed by this feature.
export async function videoFrames(url: string): Promise<string[]> {
  let objectUrl: string | undefined;
  if (allowedVideoSource(url)) {
    const response = await networkFetch("/api/video-source?url=" + encodeURIComponent(url), {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("영상 주소가 만료되었거나 영상을 읽을 수 없습니다.");
    objectUrl = URL.createObjectURL(await response.blob());
  }
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";
  const wait = (event: string) =>
    new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener(event, done);
        video.removeEventListener("error", fail);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(
          new Error(
            "영상을 읽지 못했습니다. 링크가 만료되었거나 서버가 영상 접근을 막았을 수 있습니다.",
          ),
        );
      };
      const timer = setTimeout(fail, 8000);
      video.addEventListener(event, done, { once: true });
      video.addEventListener("error", fail, { once: true });
    });
  try {
    const loaded = wait("loadeddata");
    video.src = objectUrl ?? url;
    await loaded;
    if (video.duration === Infinity) {
      const sought = wait("seeked");
      video.currentTime = 1e9;
      await sought;
    }
    if (!Number.isFinite(video.duration) || !video.videoWidth)
      throw new Error("영상 정보를 읽지 못했습니다.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("영상 장면을 읽지 못했습니다.");
    const frames: string[] = [];
    for (const fraction of [0.05, 0.5, 0.95]) {
      const time = Math.min(Math.max(0, video.duration - 0.02), video.duration * fraction);
      if (Math.abs(video.currentTime - time) > 0.001) {
        const sought = wait("seeked");
        video.currentTime = time;
        await sought;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.75));
    }
    return frames;
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError")
      throw new Error(
        "영상 서버가 장면 읽기를 허용하지 않습니다. 이 영상의 화면 분석은 사용할 수 없습니다.",
      );
    throw error;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
