export const MAIL_AUTO_SETTINGS_KEY = "voice-grok-mail-auto-v1";
export type MailAutoSettings = {
  enabled: boolean;
  usagePercent: number | null;
  reportedAt: number;
};
export function mailReplyDue(now: number, random = Math.random()) {
  return now + 60000 + Math.floor(Math.max(0, Math.min(1, random)) * 540000);
}
export function mailReplyChannel(settings: MailAutoSettings, now: number, random = Math.random()) {
  return settings.usagePercent !== null &&
    Number.isFinite(settings.usagePercent) &&
    settings.usagePercent >= 0 &&
    settings.usagePercent < 40 &&
    settings.reportedAt <= now &&
    now - settings.reportedAt <= 3600000 &&
    random < 0.5
    ? ("voice" as const)
    : ("chat" as const);
}
export function loadMailAutoSettings(): MailAutoSettings {
  try {
    const value = JSON.parse(localStorage.getItem(MAIL_AUTO_SETTINGS_KEY) ?? "null");
    if (value && typeof value.enabled === "boolean")
      return {
        enabled: value.enabled,
        usagePercent:
          typeof value.usagePercent === "number" &&
          value.usagePercent >= 0 &&
          value.usagePercent <= 100
            ? value.usagePercent
            : null,
        reportedAt: Number(value.reportedAt) || 0,
      };
  } catch {
    /* Use conservative text replies when quota is unavailable. */
  }
  return { enabled: true, usagePercent: null, reportedAt: 0 };
}
