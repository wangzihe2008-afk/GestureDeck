import type { Landmark, PoseFrame, PoseSequence } from './types';

// Anatomical left/right, never the mirrored screen coordinates.
export const JOINTS = [11, 12, 13, 14, 15, 16] as const;
export const FEATURE_SIZE = JOINTS.length * 2;
const visibility = (p: Landmark) => {
  const confidence = Math.min(p.visibility ?? 1, p.presence ?? 1);
  return Number.isFinite(confidence) ? confidence : 0;
};

export function normalizePose(
  points: Landmark[],
  t: number,
  aspect = 4 / 3,
): { frame: PoseFrame | null; quality: number; message: string } {
  if (
    points.length < 17 ||
    JOINTS.some((i) => !points[i] || !Number.isFinite(points[i].x) || !Number.isFinite(points[i].y))
  )
    return {
      frame: null,
      quality: 0,
      message: 'No upper body detected. Stand in front of the camera.',
    };
  const quality = Math.min(...JOINTS.map((i) => visibility(points[i])));
  if (quality < 0.55)
    return {
      frame: null,
      quality,
      message: 'Keep both shoulders, elbows and wrists clearly visible.',
    };
  if (
    JOINTS.some(
      (i) =>
        points[i].x < 0.015 || points[i].x > 0.985 || points[i].y < 0.015 || points[i].y > 0.985,
    )
  )
    return {
      frame: null,
      quality,
      message: 'Your arms are near the edge. Step back or adjust the camera.',
    };
  const left = points[11],
    right = points[12];
  aspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  // x/y are normalized independently by MediaPipe; correct the aspect first.
  const width = Math.hypot((left.x - right.x) * aspect, left.y - right.y);
  if (width < 0.075)
    return {
      frame: null,
      quality,
      message: 'Move a little closer and face the camera so your shoulders are clear.',
    };
  if (width > 0.85)
    return {
      frame: null,
      quality,
      message: 'You are too close. Step back until both arms fit in the frame.',
    };
  const cx = (left.x + right.x) / 2,
    cy = (left.y + right.y) / 2;
  const values = JOINTS.flatMap((i) => [
    ((points[i].x - cx) * aspect) / width,
    (points[i].y - cy) / width,
  ]);
  return { frame: { t, values }, quality, message: 'Upper body tracked · Keep facing the camera' };
}

export function relativeSequence(frames: PoseSequence): PoseSequence {
  if (!frames.length) return [];
  return frames.map((f) => ({ t: f.t - frames[0].t, values: [...f.values] }));
}

export function frameDistance(a: number[], b: number[]): number {
  if (a.length !== FEATURE_SIZE || b.length !== FEATURE_SIZE) return Infinity;
  // Wrists and elbows carry the gesture; shoulders mainly define the origin.
  const weights = [0.25, 0.25, 0.8, 0.8, 1.4, 1.4];
  let sum = 0,
    weight = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i] * ((a[i * 2] - b[i * 2]) ** 2 + (a[i * 2 + 1] - b[i * 2 + 1]) ** 2);
    weight += weights[i];
  }
  return Math.sqrt(sum / weight);
}

export function representativePose(frames: PoseSequence): number[] {
  if (!frames.length) return [];

  return Array.from({ length: FEATURE_SIZE }, (_, index) => {
    const values = frames.map((frame) => frame.values[index]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);

    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  });
}

export function motionEnergy(frames: PoseSequence): number {
  if (frames.length < 2) return 0;
  const mean = frames[0].values.map(
    (_, d) => frames.reduce((s, f) => s + f.values[d], 0) / frames.length,
  );
  return Math.sqrt(
    frames.reduce((s, f) => s + frameDistance(f.values, mean) ** 2, 0) / frames.length,
  );
}
