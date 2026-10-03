export function personaColor(name: string) {
  const names = ["아라", "서연", "혜정", "나경", "알리나", "그록"];
  const colors = ["#e9a45c", "#c4a4ea", "#ed9caf", "#88c9bb", "#8bb7e8", "#d4c271"];
  const index = names.indexOf(name);
  if (index >= 0) return colors[index];
  return colors[Array.from(name).reduce((sum, c) => sum + c.codePointAt(0)!, 0) % colors.length];
}
export async function profileImage(file: Blob): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)
    throw new Error("PNG·JPG·WebP 사진을 8MB 이내로 선택하세요.");
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("사진 처리 기능을 사용할 수 없습니다.");
    const side = Math.min(image.width, image.height);
    ctx.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
    const data = canvas.toDataURL("image/png");
    if (data.length > 200000) throw new Error("사진이 너무 복잡합니다. 더 작은 사진을 선택하세요.");
    return data;
  } finally {
    image.close();
  }
}
