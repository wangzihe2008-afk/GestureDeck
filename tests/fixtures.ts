import type { GestureTemplate, Landmark, PoseSequence } from '../src/core/types';
export function landmarks(): Landmark[] {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1, presence: 1 }));
  for (const [i, x, y] of [
    [11, 0.35, 0.3],
    [12, 0.65, 0.3],
    [13, 0.28, 0.45],
    [14, 0.72, 0.45],
    [15, 0.25, 0.6],
    [16, 0.75, 0.6],
  ])
    points[i] = { x, y, visibility: 1, presence: 1 };
  return points;
}
export function sequence(count = 24, duration = 1800, reverse = false): PoseSequence {
  return Array.from({ length: count }, (_, i) => {
    let p = i / (count - 1);
    if (reverse) p = 1 - p;
    return {
      t: (duration * i) / (count - 1),
      values: [
        -0.5,
        0,
        0.5,
        0,
        -0.8,
        0.65,
        0.8 + 0.4 * p,
        0.65 - 0.3 * p,
        -0.8,
        1.3,
        0.8 + 1.6 * p,
        1.3 - 1.4 * p,
      ],
    };
  });
}

export function poseSequence(count = 8, duration = 600): PoseSequence {
  const pose = sequence().at(-1)!.values;

  return Array.from({ length: count }, (_, index) => ({
    t: (duration * index) / (count - 1),
    values: pose.map((value, coordinate) =>
      coordinate >= 6 ? value + (index % 2 ? 0.004 : -0.004) : value,
    ),
  }));
}

export function template(id = 'right'): GestureTemplate {
  return {
    id,
    name: 'Right reach',
    command: 'NEXT_SLIDE',
    samples: [sequence(), sequence()],
    threshold: 0.2,
    cooldownMs: 1200,
    createdAt: '2026-10-28T12:00:00Z',
    enabled: true,
  };
}

export function poseTemplate(id = 'pose-right'): GestureTemplate {
  return {
    id,
    name: 'Right arm raised',
    command: 'NEXT_SLIDE',
    mode: 'pose',
    samples: [poseSequence(), poseSequence()],
    threshold: 0.24,
    cooldownMs: 1200,
    createdAt: '2026-11-02T12:00:00Z',
    enabled: true,
  };
}
