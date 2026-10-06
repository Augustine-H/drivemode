export const transcriptionProviders = [
  ["qwen", "Qwen · 로컬 / API 비용 없음"],
  ["openai", "OpenAI · gpt-transcribe"],
  ["xai", "xAI · grok-voice-transcribe-2.0"],
  ["elevenlabs", "ElevenLabs · Scribe v2"],
] as const;
export type TranscriptionProvider = typeof transcriptionProviders[number][0];
export const isTranscriptionProvider = (value: unknown): value is TranscriptionProvider =>
  transcriptionProviders.some(([id]) => id === value);
export type PaidPricing = { checkedAt: string; providers: Partial<Record<TranscriptionProvider, { model: string; estimatedUsdPerHour: number }>>; actualBillKnown: boolean };
export function estimatedTranscriptionCost(provider: TranscriptionProvider, seconds: number, pricing?: PaidPricing) {
  if (provider === "qwen") return 0;
  const rate = pricing?.providers[provider]?.estimatedUsdPerHour;
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds, 600) / 3600 * rate : undefined;
}
