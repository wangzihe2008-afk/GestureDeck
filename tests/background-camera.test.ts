import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoseWorkerReply, PoseWorkerRequest } from '../connector/src/pose-worker';
import { landmarks } from './fixtures';

import { BackgroundCamera } from '../connector/src/BackgroundCamera';

function fixture(slowWorker = false) {
  const track = {
    stop: vi.fn(),
    onended: null,
    label: 'FaceTime HD Camera',
    getSettings: () => ({ width: 640, height: 480 }),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  let source!: ReadableStreamDefaultController<VideoFrame>;
  let listener: ((event: { data: PoseWorkerReply }) => void) | undefined;
  const reply = (data: PoseWorkerReply) => listener?.({ data });
  const terminate = vi.fn();
  const post = vi.fn((request: PoseWorkerRequest, _transfer?: Transferable[]) => {
    if (request.type === 'INIT') reply({ type: 'READY' });
    else if (!slowWorker) {
      request.frame.close();
      reply({
        type: 'POSE',
        packet: {
          time: request.time,
          landmarks: landmarks(),
          frame: { t: request.time, values: [] },
          quality: 1,
          message: 'Tracking',
          width: request.frame.displayWidth,
          height: request.frame.displayHeight,
        },
      });
    }
  });

  const frames = new ReadableStream<VideoFrame>({
    start(controller) {
      source = controller;
    },
  });
  const processor = vi.fn(function () {
    return { readable: frames };
  });

  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
  vi.stubGlobal('MediaStreamTrackProcessor', processor);
  vi.stubGlobal(
    'Worker',
    class {
      set onmessage(value: typeof listener) {
        listener = value;
      }
      postMessage = post;
      terminate = terminate;
    },
  );

  async function emit(time: number) {
    await vi.advanceTimersByTimeAsync(time - performance.now());

    const frame = { displayWidth: 640, displayHeight: 480, timestamp: time * 1000, close: vi.fn() };
    source.enqueue(frame as unknown as VideoFrame);
    await Promise.resolve();
    await Promise.resolve();

    return frame;
  }

  return { track, processor, emit, reply, post, terminate };
}

describe('direct background camera capture', () => {
  let camera: BackgroundCamera | null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  });

  afterEach(async () => {
    camera?.stop();
    camera = null;
    await Promise.resolve();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keeps receiving native frames without a visible video element or display callbacks', async () => {
    const source = fixture();
    const packets = vi.fn();
    camera = new BackgroundCamera(packets, vi.fn());
    await camera.start('chrome-extension://test/');

    for (let index = 0; index <= 30; index++) {
      const frame = await source.emit((index * 1000) / 30);
      expect(frame.close).toHaveBeenCalledOnce();
    }

    expect(source.processor).toHaveBeenCalledWith({ track: source.track, maxBufferSize: 1 });
    expect(packets.mock.calls.length).toBeGreaterThanOrEqual(19);
    expect(packets.mock.calls.length).toBeLessThanOrEqual(21);
    expect(packets.mock.calls.at(-1)![0].fps).toBeGreaterThanOrEqual(19);
    expect(camera.getInfo().captureFps).toBe(30);
    expect(packets.mock.calls[0][0].frame).not.toBeNull();
  });

  it('keeps previewing every camera frame while one inference is in flight', async () => {
    const source = fixture(true);
    const preview = vi.fn();
    camera = new BackgroundCamera(vi.fn(), vi.fn(), preview);
    await camera.start('chrome-extension://test/');

    const first = await source.emit(100);
    for (let index = 1; index <= 30; index++) {
      const frame = await source.emit(100 + (index * 1000) / 30);
      expect(frame.close).toHaveBeenCalledOnce();
    }

    expect(preview).toHaveBeenCalledTimes(31);
    expect(source.post.mock.calls.filter(([request]) => request.type === 'FRAME')).toHaveLength(1);
    expect(source.post).toHaveBeenLastCalledWith(expect.objectContaining({ frame: first }), [
      first,
    ]);
    expect(first.close).not.toHaveBeenCalled();
    expect(camera.getInfo().captureFps).toBe(30);
  });

  it('releases the camera and worker when inference fails', async () => {
    const source = fixture(true);
    const error = vi.fn();

    camera = new BackgroundCamera(vi.fn(), error);
    await camera.start('chrome-extension://test/');

    await source.emit(100);
    source.reply({ type: 'ERROR', message: 'Model failed' });

    expect(source.terminate).toHaveBeenCalledOnce();
    expect(source.track.stop).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Model failed'));
  });

  it('cancels a pending read and releases the camera when stopped', async () => {
    const source = fixture();
    const packets = vi.fn();
    const error = vi.fn();

    camera = new BackgroundCamera(packets, error);
    await camera.start('chrome-extension://test/');
    await source.emit(100);
    camera.stop();
    await Promise.resolve();

    expect(source.track.stop).toHaveBeenCalledOnce();
    expect(source.terminate).toHaveBeenCalledOnce();
    expect(packets).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it('reports a stalled native stream instead of continuing to show readiness', async () => {
    const source = fixture();
    const error = vi.fn();

    camera = new BackgroundCamera(vi.fn(), error);
    await camera.start('chrome-extension://test/');
    await vi.advanceTimersByTimeAsync(9000);

    expect(error).toHaveBeenCalledWith(expect.stringContaining('stopped delivering frames'));
    expect(source.track.stop).toHaveBeenCalledOnce();
  });
});
