import { createServerFn } from "@tanstack/react-start";

export const recognizeMusic = createServerFn({ method: "POST" })
  .validator((input: { audio: string; mime: string }) => {
    if (!/^[A-Za-z0-9+/]+=*$/.test(input.audio) || input.audio.length > 4_000_000)
      throw new Error("오디오 크기 또는 형식이 올바르지 않습니다.");
    if (!/^audio\/(webm|ogg|mp4|wav|mpeg)(;codecs=[\w,-]+)?$/.test(input.mime))
      throw new Error("지원하지 않는 녹음 형식입니다.");
    return input;
  })
  .handler(async ({ data }) => {
    const token = process.env.AUDD_API_TOKEN;
    if (!token)
      return {
        ok: false as const,
        error:
          "곡 찾기 연결이 필요합니다. 서버에 AUDD_API_TOKEN을 설정하세요. 음량·박자 분석은 사용할 수 있습니다.",
      };
    const body = new FormData();
    body.append("api_token", token);
    const bytes = Uint8Array.from(Buffer.from(data.audio, "base64"));
    body.append(
      "file",
      new Blob([bytes], { type: data.mime }),
      "sample." + (data.mime.includes("mp4") ? "m4a" : data.mime.includes("ogg") ? "ogg" : "webm"),
    );
    try {
      const response = await fetch("https://api.audd.io/", {
        method: "POST",
        body,
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok)
        return { ok: false as const, error: "곡 찾기 서비스에 연결하지 못했습니다." };
      const result = (await response.json()) as {
        status?: string;
        result?: { title?: string; artist?: string; album?: string };
        error?: { error_code?: number };
      };
      if (result.status !== "success")
        return {
          ok: false as const,
          error: "곡 찾기 요청이 실패했습니다. 서비스 키와 사용 한도를 확인하세요.",
        };
      if (!result.result?.title)
        return {
          ok: false as const,
          error: "곡을 찾지 못했습니다. 음악이 더 잘 들리는 곳에서 다시 시도하세요.",
        };
      return {
        ok: true as const,
        title: result.result.title.slice(0, 200),
        artist: (result.result.artist ?? "").slice(0, 200),
        album: (result.result.album ?? "").slice(0, 200),
      };
    } catch {
      return { ok: false as const, error: "곡 찾기 시간이 초과되었거나 연결이 끊겼습니다." };
    }
  });
