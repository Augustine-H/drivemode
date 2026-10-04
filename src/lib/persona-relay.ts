import type { Turn } from "./transcript";
export const relayMemoryKey = (id: string) => `relay-memory:${id}`;

export function rememberRelays(threads: Record<string, Turn[]>) {
  const next: Record<string, Turn[]> = {};
  const memories = new Map<string, Map<string, Turn>>();
  for (const [room, turns] of Object.entries(threads)) {
    next[room] = [];
    for (const turn of turns) {
      if (turn.relay && !turn.event) {
        const key = relayMemoryKey(turn.relay.toId);
        if (!memories.has(key)) memories.set(key, new Map());
        memories.get(key)!.set(turn.id, {
          ...turn,
          audience: [...new Set([turn.relay.fromId, turn.relay.toId])],
        });
      } else next[room].push(turn);
    }
  }
  for (const [key, turns] of memories) next[key] = [...(next[key] ?? []), ...turns.values()];
  return next;
}

export function storeRelay(
  threads: Record<string, Turn[]>,
  sourceRoom: string,
  delivery: { incoming: Turn; receipt: Turn },
) {
  const target = relayMemoryKey(delivery.incoming.relay!.toId);
  return {
    ...threads,
    [sourceRoom]: [...(threads[sourceRoom] ?? []), delivery.receipt],
    [target]: [...(threads[target] ?? []), delivery.incoming],
  };
}
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
    audience: [...new Set([input.from.id, input.to.id])],
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
