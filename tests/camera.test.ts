import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { landmarks } from './fixtures';

const vision = vi.hoisted(() => ({
  resolve: vi.fn(),
  create: vi.fn(),
  detect: vi.fn(),
  close: vi.fn(),
}));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vision.resolve },
  PoseLandmarker: { createFromOptions: vision.create },
}));
import { PoseCamera } from '../src/vision/PoseCamera';

function fixture(frameDriven = false) {
  const track = { stop: vi.fn(), onended: null };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
  const context = { drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => context };
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  let callbackId = 0;

  const requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
    const id = ++callbackId;
    callbacks.set(id, callback);
    return id;
  });
  const cancelVideoFrameCallback = vi.fn((id: number) => callbacks.delete(id));

  const video: Record<string, unknown> = {
    play: vi.fn(async () => {}),
    srcObject: null,
    muted: false,
    playsInline: false,
    readyState: 4,
    currentTime: 1,
    videoWidth: 640,
    videoHeight: 480,
    ownerDocument: { createElement: vi.fn(() => canvas) },
  };

  if (frameDriven) {
    video.requestVideoFrameCallback = requestVideoFrameCallback;
    video.cancelVideoFrameCallback = cancelVideoFrameCallback;
  }

  function fireFrame(now: number) {
    const entry = callbacks.entries().next().value as
      | [number, VideoFrameRequestCallback]
      | undefined;
    if (!entry) throw new Error('No video frame callback is waiting.');

    callbacks.delete(entry[0]);
    entry[1](now, {} as VideoFrameCallbackMetadata);
  }

  return {
    track,
    stream,
    context,
    canvas,
    video: video as unknown as HTMLVideoElement,
    requestVideoFrameCallback,
    cancelVideoFrameCallback,
    fireFrame,
  };
}

describe('camera frame delivery', () => {
  let camera: PoseCamera | undefined;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vision.resolve.mockResolvedValue({});
    vision.detect.mockReturnValue({ landmarks: [landmarks()] });
    vision.create.mockResolvedValue({ detectForVideo: vision.detect, close: vision.close });
  });
  afterEach(() => {
    camera?.stop();
    camera = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('copies a background video frame to canvas before running the model', async () => {
    const f = fixture(),
      packet = vi.fn();
    camera = new PoseCamera(f.video, packet, vi.fn(), { canvasFrames: true });
    await camera.start('http://localhost/');
    await vi.advanceTimersByTimeAsync(1);
    expect(f.context.drawImage).toHaveBeenCalledWith(f.video, 0, 0, 640, 480);
    expect(vision.detect).toHaveBeenCalledWith(f.canvas, expect.any(Number));
    expect(packet.mock.calls[0][0].frame).not.toBeNull();
  });
  it('keeps the PDF camera input unchanged', async () => {
    const f = fixture();
    camera = new PoseCamera(f.video, vi.fn(), vi.fn());
    await camera.start('http://localhost/');
    await vi.advanceTimersByTimeAsync(1);
    expect(vision.detect).toHaveBeenCalledWith(f.video, expect.any(Number));
    expect(f.context.drawImage).not.toHaveBeenCalled();
  });
  it('uses actual video frame callbacks and reports measured recognition FPS', async () => {
    const f = fixture(true);
    const packet = vi.fn();

    camera = new PoseCamera(f.video, packet, vi.fn(), { canvasFrames: true });
    await camera.start('http://localhost/');

    expect(f.requestVideoFrameCallback).toHaveBeenCalledOnce();

    f.fireFrame(1000);
    f.video.currentTime = 2;
    f.fireFrame(1100);

    expect(vision.detect).toHaveBeenCalledTimes(2);
    expect(packet.mock.calls[1][0].fps).toBe(10);

    camera.stop();
    expect(f.cancelVideoFrameCallback).toHaveBeenCalled();
  });
  it('reports frozen video and releases the camera instead of showing a stale ready state', async () => {
    const f = fixture(),
      error = vi.fn();
    camera = new PoseCamera(f.video, vi.fn(), error, { canvasFrames: true });
    await camera.start('http://localhost/');
    await vi.advanceTimersByTimeAsync(8100);
    expect(vision.detect).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('stopped delivering video frames'));
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.video.srcObject).toBeNull();
  });
  it('does not pass an empty, zero-size camera frame into MediaPipe', async () => {
    const f = fixture();
    Object.defineProperty(f.video, 'videoWidth', { value: 0 });
    Object.defineProperty(f.video, 'videoHeight', { value: 0 });
    camera = new PoseCamera(f.video, vi.fn(), vi.fn(), { canvasFrames: true });
    await camera.start('http://localhost/');
    await vi.advanceTimersByTimeAsync(100);
    expect(vision.detect).not.toHaveBeenCalled();
  });
  it('closes a late-loading model after the user has stopped the camera', async () => {
    let resolveModel!: (model: unknown) => void;
    vision.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveModel = resolve;
        }),
    );
    const f = fixture();
    camera = new PoseCamera(f.video, vi.fn(), vi.fn(), { canvasFrames: true });
    const started = camera.start('http://localhost/');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    camera.stop();
    resolveModel({ detectForVideo: vision.detect, close: vision.close });
    await started;
    expect(vision.close).toHaveBeenCalled();
    expect(f.track.stop).toHaveBeenCalled();
    expect(vision.detect).not.toHaveBeenCalled();
  });
});
