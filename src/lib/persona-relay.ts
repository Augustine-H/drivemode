import type { Turn } from "./transcript";
export function relayDelivery(input: {
  from: { id: string; name: string; voice?: string };
  to: { id: string; name: string };
  request: string;
  payload: string;
  media?: Turn;
  at: number;
  sourceAudience: string[];
  targetAudience: string[];
}) {
  const relay = {
    fromId: input.from.id,
    fromName: input.from.name,
    toId: input.to.id,
    toName: input.to.name,
    request: input.request,
    payload: input.payload,
  };
  const incoming: Turn = {
    id: `relay-${input.at.toString(36)}-${input.to.id}`,
    speaker: "grok",
    text: input.payload,
    personaId: input.from.id,
    personaName: input.from.name,
    voice: input.from.voice,
    at: input.at,
    relay,
    image: input.media?.image,
    video: input.media?.video,
    mediaDescription: input.media?.mediaDescription,
    audience: [
      ...new Set([input.from.id, input.to.id, ...input.sourceAudience, ...input.targetAudience]),
    ],
  };
  const receipt: Turn = {
    id: `relay-notice-${input.at.toString(36)}`,
    speaker: "grok",
    event: "relay",
    textOnly: true,
    personaId: input.from.id,
    personaName: input.from.name,
    at: input.at,
    relay,
    text: `${input.from.name} → ${input.to.name}: ${input.media?.video ? "영상" : input.media?.image ? "사진" : "내용"} 전달 완료`,
    audience: [...new Set([input.from.id, ...input.sourceAudience])],
  };
  return { incoming, receipt };
}
