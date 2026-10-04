import type { Turn } from "./transcript";

export function participantCommand(text: string, personas: { id: string; name: string }[]) {
  const compact = text.replace(/\s+/g, "");
  if (/하지마|시키지마|보내지마|말고|않/.test(compact)) return null;
  const action = /초대|불러줘|불러와|참여시켜|들어오라고/.test(compact)
    ? "join"
    : /나가(?:줘|라고|게해|세요)?[.!?]*$|퇴장(?:시켜|해)|내보내/.test(compact)
      ? "leave"
      : null;
  if (!action) return null;
  const person = [...personas]
    .filter((p) => compact.includes(p.name))
    .sort((a, b) => compact.lastIndexOf(b.name) - compact.lastIndexOf(a.name))[0];
  return person ? { id: person.id, action } : null;
}

export function roomChanges(host: string, before: string[], requested: string[]) {
  const members = [...new Set([host, ...requested])].slice(0, 6);
  return {
    members,
    joined: members.filter((id) => !before.includes(id)),
    left: before.filter((id) => !members.includes(id) && id !== host),
  };
}

export function knownTurns(threads: Record<string, Turn[]>, id: string) {
  const seen = new Set<string>();
  const known = Object.entries(threads)
    .flatMap(([room, list]) =>
      list.filter((turn) => {
        if (
          (room !== id && !(Array.isArray(turn.audience) && turn.audience.includes(id))) ||
          seen.has(turn.id)
        )
          return false;
        seen.add(turn.id);
        return true;
      }),
    )
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const references = new Set(known.map((t) => t.mediaRef).filter(Boolean));
  for (const turn of Object.values(threads).flat()) {
    if (references.has(turn.id) && (turn.image || turn.video) && !seen.has(turn.id)) {
      known.push(turn);
      seen.add(turn.id);
    }
  }
  return known.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

export function turnRecord(turn: Turn) {
  if (turn.event)
    return `${turn.event === "relay" ? "전달 기록" : "방 참여 기록"}${turn.at ? " (" + new Date(turn.at).toISOString() + ")" : ""}: ${turn.text}`;
  return `${turn.speaker === "me" ? "사용자" : turn.personaName || "페르소나"}: ${turn.text}${turn.relay ? " [" + turn.relay.fromName + " → " + turn.relay.toName + "에게 전달한 내용]" : ""}${turn.image ? " [사진: " + (turn.mediaDescription || "보낸 사진") + "]" : ""}${turn.video ? " [영상: " + (turn.mediaDescription || "보낸 영상") + "]" : ""}`;
}

export function rememberRoomEvents(
  threads: Record<string, Turn[]>,
  personas: { id: string; name: string }[],
) {
  return Object.fromEntries(
    Object.entries(threads).map(([room, turns]) => [
      room,
      turns.map((turn) => {
        if (turn.event !== "join" && turn.event !== "leave") return turn;
        const person = personas.find(
          (p) => p.id === turn.personaId || turn.text.startsWith(p.name + " 님이"),
        );
        const host = personas.find((p) => p.id === room);
        if (!person) return turn;
        return {
          ...turn,
          personaId: person.id,
          personaName: person.name,
          audience: [
            ...new Set([
              ...(Array.isArray(turn.audience) ? turn.audience : []),
              person.id,
              ...(host ? [host.id] : []),
            ]),
          ],
          text:
            host && !turn.text.includes(" 방에") && !turn.text.includes(" 방에서")
              ? `${person.name} 님이 ${host.name} 방${turn.event === "join" ? "에 초대되어 들어왔습니다" : "에서 나갔습니다"}.`
              : turn.text,
        };
      }),
    ]),
  );
}

export function conversationMemory(threads: Record<string, Turn[]>, id: string, question: string) {
  const all = knownTurns(threads, id);
  const words = (question.match(/[가-힣a-zA-Z0-9]{2,}/g) ?? [])
    .map((word) => word.replace(/(?:에게|한테|에서|으로|은|는|이|가|을|를|에|도)$/, ""))
    .filter(
      (word) =>
        word.length >= 2 &&
        !/^(아까|최근|방금|받은|보낸|얘기한|설명해줘|해줘|이거|그거)$/.test(word),
    );
  const relevant = new Set<number>();
  for (let i = 0; i < all.length; i++) {
    if (words.some((word) => turnRecord(all[i]).includes(word))) {
      for (let j = Math.max(0, i - 2); j <= Math.min(all.length - 1, i + 2); j++) relevant.add(j);
    }
  }
  const recent = all.slice(-16);
  const matches = [...relevant].slice(-20).map((i) => all[i]);
  const relevantText = matches
    .map((turn) => turnRecord(turn).slice(0, 800))
    .join("\n")
    .slice(-3500);
  const recentText = recent
    .filter((turn) => !matches.some((match) => match.id === turn.id))
    .map((turn) => turnRecord(turn).slice(0, 800))
    .join("\n")
    .slice(-1800);
  const events = all
    .filter((turn) => turn.event)
    .slice(-8)
    .map(turnRecord)
    .join("\n")
    .slice(-1100);
  return [relevantText, recentText, events].filter(Boolean).join("\n");
}

export function findQuestionMedia(turns: Turn[], question: string, selectedId?: string | null) {
  if (selectedId) return turns.find((t) => t.id === selectedId && (t.image || t.video));
  if (!/사진|이미지|그림|셀카|영상|동영상|비디오|보낸|보내준|이거|그거|묘사|설명/.test(question))
    return undefined;
  const video = /영상|동영상|비디오/.test(question);
  const candidates = turns.filter((t) => (video ? t.video : t.image));
  const words =
    question
      .replace(/최근|방금|아까|받은|보낸|사진|이미지|영상|설명|묘사|해줘|해봐/g, " ")
      .match(/[가-힣a-zA-Z]{2,}/g) ?? [];
  return (
    [...candidates].reverse().find((t) => words.some((w) => t.mediaDescription?.includes(w))) ??
    candidates.at(-1)
  );
}
