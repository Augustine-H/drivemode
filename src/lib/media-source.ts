export function allowedMediaSource(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      ["data.x.ai", "vidgen.x.ai", "imgen.x.ai"].includes(u.hostname) &&
      value.length <= 4000
    );
  } catch {
    return false;
  }
}
