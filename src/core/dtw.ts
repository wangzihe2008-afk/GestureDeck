import type { PoseSequence } from './types';
import { frameDistance } from './normalize';

// Sakoe-Chiba band: allow speed changes without aligning unrelated extremes.
// Divide by path length, rather than sequence length, for comparable thresholds.
export function dtwDistance(a: PoseSequence, b: PoseSequence, bandRatio = 0.35): number {
  if (!a.length || !b.length) return Infinity;
  const n = a.length,
    m = b.length,
    band = Math.max(Math.abs(n - m), Math.ceil(Math.max(n, m) * bandRatio));
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  const lengths = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  cost[0][0] = 0;
  for (let i = 1; i <= n; i++)
    for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) {
      let pi = i - 1,
        pj = j - 1;
      if (cost[i - 1][j] < cost[pi][pj]) {
        pi = i - 1;
        pj = j;
      }
      if (cost[i][j - 1] < cost[pi][pj]) {
        pi = i;
        pj = j - 1;
      }
      cost[i][j] = cost[pi][pj] + frameDistance(a[i - 1].values, b[j - 1].values);
      lengths[i][j] = lengths[pi][pj] + 1;
    }
  return lengths[n][m] ? cost[n][m] / lengths[n][m] : Infinity;
}

export function resample(frames: PoseSequence, count = 24): PoseSequence {
  if (frames.length < 2) return frames.map((f) => ({ ...f, values: [...f.values] }));
  const first = frames[0].t,
    duration = frames.at(-1)!.t - first;
  if (duration <= 0) return [];
  let cursor = 0;
  return Array.from({ length: count }, (_, i) => {
    const t = first + (duration * i) / (count - 1);
    while (cursor < frames.length - 2 && frames[cursor + 1].t < t) cursor++;
    const a = frames[cursor],
      b = frames[cursor + 1];
    const mix = Math.max(0, Math.min(1, (t - a.t) / Math.max(1, b.t - a.t)));
    return { t: t - first, values: a.values.map((v, d) => v + (b.values[d] - v) * mix) };
  });
}

// A display index, NOT an empirical probability or a measured accuracy rate.
export const distanceToScore = (distance: number) => Math.round(100 * Math.exp(-2.5 * distance));
