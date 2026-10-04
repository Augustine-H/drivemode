export function allowedVideoSource(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["vidgen.x.ai", "data.x.ai"].includes(url.hostname) &&
      value.length <= 4000
    );
  } catch {
    return false;
  }
}
