export function wakeForms(name: string) {
  const key = name.replace(/\s+/g, "").trim();
  if (!key) return [];
  const code = key.charCodeAt(key.length - 1) - 0xac00;
  const consonant = code >= 0 && code <= 11171 && code % 28 !== 0;
  return [
    ...new Set([
      consonant ? `${key}아` : `${key}야`,
      consonant ? `${key}이` : `${key}아`,
      `${key}야`,
    ]),
  ];
}

export function takePersonaWake(text: string, personas: { id: string; name: string }[]) {
  for (const persona of personas) {
    if (
      text.replace(/[\s.,!?~…"'“”]/g, "").normalize("NFC") ===
      persona.name.replace(/\s+/g, "").normalize("NFC")
    )
      return { id: persona.id, rest: "" };
    const rest = takeWake(text, persona.name);
    if (rest !== null) return { id: persona.id, rest };
  }
  return null;
}

export function takeWake(text: string, name: string) {
  const compact = text.replace(/[\s.,!?~…"'“”]/g, "");
  if (!compact) return null;
  for (const form of wakeForms(name)) {
    const at = compact.indexOf(form);
    if (at < 0 || at > 4) continue;
    return compact.slice(at + form.length);
  }
  return null;
}
