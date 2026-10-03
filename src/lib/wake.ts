export function wakeForms(name: string) {
  const key = name.replace(/\s+/g, "").trim();
  if (!key) return [];
  return [`${key}야`, `${key}아`];
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
