import { createServerFn } from "@tanstack/react-start";
import { chooseMusicMatch, type Candidate } from "./music-match";
export const identifyMusic = createServerFn({ method: "POST" })
  .validator((data: { fingerprint: string; duration: number }) => {
    if (
      !/^[A-Za-z0-9_+\x2f-]+=*$/.test(data.fingerprint) ||
      data.fingerprint.length > 12000 ||
      !Number.isFinite(data.duration) ||
      data.duration < 8 ||
      data.duration > 15.1
    )
      throw new Error("음악 지문 형식이 올바르지 않습니다.");
    return data;
  })
  .handler(async ({ data }) => {
    const key = process.env.ACOUSTID_APP_KEY;
    if (!key)
      return {
        ok: false as const,
        error:
          "음악 식별 연결이 필요합니다. 서버에 ACOUSTID_APP_KEY를 설정하세요. 곡명은 추측하지 않습니다.",
      };
    try {
      const res = await fetch("https://api.acoustid.org/v2/lookup", {
        method: "POST",
        body: new URLSearchParams({
          client: key,
          duration: String(Math.round(data.duration)),
          fingerprint: data.fingerprint,
          meta: "recordings releasegroups",
          format: "json",
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return { ok: false as const, error: "음악 식별 서비스에 연결하지 못했습니다." };
      const body = (await res.json()) as { status?: string; results?: Candidate[] };
      const match = body.status === "ok" ? chooseMusicMatch(body.results ?? []) : null;
      return match
        ? { ok: true as const, ...match }
        : {
            ok: false as const,
            error:
              "곡을 확실히 찾지 못했습니다. 짧은 구간이나 주변 소음은 AcoustID에서 식별하기 어렵습니다.",
          };
    } catch {
      return { ok: false as const, error: "음악 식별 연결이 끊겼거나 시간이 초과되었습니다." };
    }
  });
