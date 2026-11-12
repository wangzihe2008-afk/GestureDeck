import type { Landmark, PoseSequence } from '../core/types';
export const BONES: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
];
export function drawSkeleton(canvas: HTMLCanvasElement, points: Landmark[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  // MediaPipe can briefly return a visible landmark with a non-finite coordinate
  // while tracking is being reacquired. Canvas throws on NaN/Infinity, so skip it.
  const visible = (i: number) =>
    Boolean(
      points[i] &&
        Number.isFinite(points[i].x) &&
        Number.isFinite(points[i].y) &&
        (points[i].visibility ?? 0) > 0.5,
    );
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ccec9e';
  ctx.lineCap = 'round';
  for (const [a, b] of BONES)
    if (visible(a) && visible(b)) {
      ctx.beginPath();
      ctx.moveTo(points[a].x * w, points[a].y * h);
      ctx.lineTo(points[b].x * w, points[b].y * h);
      ctx.stroke();
    }
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24])
    if (visible(i)) {
      ctx.beginPath();
      ctx.arc(points[i].x * w, points[i].y * h, 5, 0, Math.PI * 2);
      ctx.fillStyle = [15, 16].includes(i) ? '#f5b881' : '#eaffd5';
      ctx.fill();
    }
}
export function previewPaths(frames: PoseSequence) {
  return [4, 5].map((joint) =>
    frames
      .map(
        (f, i) =>
          `${i ? 'L' : 'M'}${80 + f.values[joint * 2] * 24},${35 + f.values[joint * 2 + 1] * 24}`,
      )
      .join(' '),
  );
}
