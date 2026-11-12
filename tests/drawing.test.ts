import { describe, expect, it, vi } from 'vitest';
import { drawSkeleton } from '../src/vision/drawing';
import { landmarks } from './fixtures';

describe('live skeleton preview', () => {
  it('skips non-finite landmarks instead of crashing Canvas', () => {
    const finite = (value: number) => {
      expect(Number.isFinite(value)).toBe(true);
    };
    const context = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn((x: number, y: number) => {
        finite(x);
        finite(y);
      }),
      lineTo: vi.fn((x: number, y: number) => {
        finite(x);
        finite(y);
      }),
      arc: vi.fn((x: number, y: number, radius: number) => {
        finite(x);
        finite(y);
        finite(radius);
      }),
      lineWidth: 0,
      strokeStyle: '',
      lineCap: '',
      fillStyle: '',
    };
    const points = landmarks();
    points[0] = { x: NaN, y: 0.2, visibility: 1 };
    points[23] = { x: Infinity, y: 0.8, visibility: 1 };
    expect(() =>
      drawSkeleton(
        { width: 640, height: 480, getContext: () => context } as unknown as HTMLCanvasElement,
        points,
      ),
    ).not.toThrow();
    expect(context.arc).toHaveBeenCalled();
  });
});
