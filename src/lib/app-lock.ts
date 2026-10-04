export type LockConfig = { salt: string; hash: string };
export const LOCK_KEY = "voice-grok-app-lock";
export const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", iterations: 310000, salt: new TextEncoder().encode(salt) },
      key,
      256,
    ),
  );
}
export async function makeLock(password: string): Promise<LockConfig> {
  if (password.length < 4) throw new Error("비밀번호는 4글자 이상 입력하세요.");
  const salt = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  return { salt, hash: await hashPassword(password, salt) };
}
export async function checkLock(password: string, config: LockConfig) {
  if (!/^[a-f0-9]{64}$/.test(config.salt) || !/^[a-f0-9]{64}$/.test(config.hash)) return false;
  const actual = await hashPassword(password, config.salt);
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ config.hash.charCodeAt(i);
  return diff === 0;
}
