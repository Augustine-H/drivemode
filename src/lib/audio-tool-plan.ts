import { createServerFn } from "@tanstack/react-start";
import { audioIntent, audioToolNames, audioToolSchemas, type AudioToolName } from "./audio-tools";
export const planAudioTool = createServerFn({ method: "POST" })
  .validator((data: { text: string }) => ({ text: String(data.text).slice(0, 1000) }))
  .handler(async ({ data }): Promise<AudioToolName | null> => {
    const fallback = audioIntent(data.text);
    if (!fallback || !process.env.XAI_API_KEY) return fallback;
    try {
      const res = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "grok-4.5",
          store: false,
          max_output_tokens: 80,
          instructions:
            "Select exactly one available audio tool for this explicit recent-audio question. Never answer or identify a song yourself. Transcription only for an explicit request to transcribe words.",
          input: [{ role: "user", content: data.text }],
          tools: audioToolSchemas,
          tool_choice: "required",
          parallel_tool_calls: false,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return fallback;
      const body = (await res.json()) as { output?: { type: string; name?: string }[] };
      const call = body.output?.find((item) => item.type === "function_call");
      return audioToolNames.includes(call?.name as AudioToolName)
        ? (call!.name as AudioToolName)
        : fallback;
    } catch {
      return fallback;
    }
  });
