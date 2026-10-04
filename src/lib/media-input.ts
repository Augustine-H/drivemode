import { getMedia, readMediaBlob } from "./media-repository";
import { videoFrames } from "./video-frames";
import type { Turn } from "./transcript";
async function smallImage(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("사진 장면을 읽지 못했습니다.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75);
  } finally {
    bitmap.close();
  }
}
export async function questionMedia(turn: Turn | undefined) {
  if (!turn) return { image: undefined, frames: undefined, note: "" };
  const id = turn.mediaIds?.[0];
  if (!id)
    return {
      image: turn.image,
      frames: turn.video ? await videoFrames(turn.video) : undefined,
      note: "",
    };
  const item = await getMedia(id);
  if (item?.lifecycle !== "active")
    return {
      image: undefined,
      frames: undefined,
      note: "이 미디어 기록은 있지만 원본은 삭제되었거나 휴지통에 있다. 실제 화면을 보았다고 주장하지 않는다.",
    };
  const blob = await readMediaBlob(id);
  if (!blob)
    return {
      image: undefined,
      frames: undefined,
      note: "원본 파일 없음: 백업에서 복원해야 한다. 다른 사진으로 대신 분석하지 않는다.",
    };
  if (turn.image) return { image: await smallImage(blob), frames: undefined, note: "" };
  const url = URL.createObjectURL(blob);
  try {
    return { image: undefined, frames: await videoFrames(url), note: "" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
