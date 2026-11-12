import { afterEach, expect, it, vi } from 'vitest';
import type { PoseWorkerRequest } from '../connector/src/pose-worker';
import { landmarks } from './fixtures';

const create = vi.hoisted(() => vi.fn());
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  PoseLandmarker: { createFromOptions: create },
}));

afterEach(() => vi.unstubAllGlobals());

it('retries an interrupted GPU inference on CPU and releases the transferred frame', async () => {
  const gpu = {
    close: vi.fn(),
    detectForVideo: () => {
      throw new Error('GPU context lost');
    },
  };
  const cpu = {
    detectForVideo: (
      _frame: VideoFrame,
      _time: number,
      callback: (result: { landmarks: ReturnType<typeof landmarks>[] }) => void,
    ) => {
      callback({ landmarks: [landmarks()] });
    },
  };
  create.mockResolvedValueOnce(gpu).mockResolvedValueOnce(cpu);
  const worker = {
    onmessage: null as null | ((event: { data: PoseWorkerRequest }) => void),
    postMessage: vi.fn(),
  };
  vi.stubGlobal('self', worker);
  await import('../connector/src/pose-worker');

  worker.onmessage!({ data: { type: 'INIT', assetBase: 'chrome-extension://test/' } });
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith({ type: 'READY' }));

  const frame = { displayWidth: 480, displayHeight: 360, close: vi.fn() };
  worker.onmessage!({ data: { type: 'FRAME', frame: frame as unknown as VideoFrame, time: 100 } });
  await vi.waitFor(() =>
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      type: 'POSE',
      packet: expect.objectContaining({ time: 100, width: 480, height: 360 }),
    }),
  );
  expect(create.mock.calls.map(([, options]) => options.baseOptions.delegate)).toEqual([
    'GPU',
    'CPU',
  ]);
  expect(gpu.close).toHaveBeenCalledOnce();
  expect(frame.close).toHaveBeenCalledOnce();
});
