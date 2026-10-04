export type MusicMatch = { title: string; artist: string; album?: string; score: number };
export type Candidate = {
  score?: number;
  recordings?: {
    title?: string;
    artists?: { name?: string }[];
    releasegroups?: { title?: string }[];
  }[];
};
export function chooseMusicMatch(results: Candidate[]): MusicMatch | null {
  const candidates = results
    .filter(
      (r) =>
        Number.isFinite(r.score) &&
        r.score! >= 0 &&
        r.score! <= 1 &&
        r.recordings?.some((x) => x.title && x.artists?.some((a) => a.name)),
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const best = candidates[0];
  if (
    !best ||
    (best.score ?? 0) < 0.8 ||
    (candidates[1] && (best.score ?? 0) - (candidates[1].score ?? 0) < 0.05)
  )
    return null;
  const recording = best.recordings!.find((x) => x.title && x.artists?.some((a) => a.name))!;
  const identities = new Set(
    best.recordings!.map((x) => `${x.title}|${x.artists?.map((a) => a.name).join(",")}`),
  );
  if (identities.size > 1) return null;
  return {
    title: recording.title!.slice(0, 200),
    artist: recording
      .artists!.map((a) => a.name)
      .filter(Boolean)
      .join(", ")
      .slice(0, 200),
    album: recording.releasegroups?.[0]?.title?.slice(0, 200),
    score: best.score!,
  };
}
