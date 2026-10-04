export function audioLevel(samples: Float32Array) {
  let energy = 0;
  let peak = 0;
  for (const value of samples) {
    energy += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(energy / Math.max(1, samples.length));
  return { rms, peak, db: Math.max(-90, 20 * Math.log10(Math.max(0.00003, rms))) };
}

// Autocorrelate positive energy changes, rather than interpreting loudness as tempo.
export function estimateTempo(levels: number[], interval = 0.05): number | null {
  if (levels.length * interval < 6) return null;
  const onset = levels.map((value, i) => Math.max(0, value - (levels[i - 1] ?? value)));
  const energy = onset.reduce((sum, value) => sum + value * value, 0);
  if (energy < 0.00001) return null;
  let best = 0;
  let lag = 0;
  for (
    let shift = Math.ceil(60 / 180 / interval);
    shift <= Math.floor(60 / 60 / interval);
    shift++
  ) {
    let score = 0;
    let a = 0;
    let b = 0;
    for (let i = shift; i < onset.length; i++) {
      score += onset[i] * onset[i - shift];
      a += onset[i] ** 2;
      b += onset[i - shift] ** 2;
    }
    score /= Math.sqrt(a * b) || 1;
    if (score > best + 0.02) {
      best = score;
      lag = shift;
    }
  }
  return best >= 0.3 && lag ? Math.round(60 / (lag * interval)) : null;
}

export function musicCommand(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (/하지마|말고|중지|취소/.test(compact)) return false;
  return /(?:지금|현재|나오는|들리는).*(?:곡|노래|음악).*(?:알려|찾아|뭐|제목|분석)|(?:곡|노래|음악).*(?:음량|박자|템포).*(?:분석|알려)|음량.*박자.*분석/.test(
    compact,
  );
}
