// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PosePacket } from '../src/core/types';
import { drawSkeleton } from '../src/vision/drawing';
import { landmarks, poseSequence, poseTemplate, sequence, template } from './fixtures';

const camera = vi.hoisted(() => ({
  packet: null as null | ((p: PosePacket) => void),
  preview: null as null | ((frame: VideoFrame, time: number) => void),
  start: vi.fn(async () => {}),
  stop: vi.fn(),
}));
vi.mock('../connector/src/BackgroundCamera', () => ({
  BackgroundCamera: class {
    constructor(
      onPacket: (p: PosePacket) => void,
      _onError: unknown,
      onPreview: (frame: VideoFrame, time: number) => void,
    ) {
      camera.packet = onPacket;
      camera.preview = onPreview;
    }
    start = camera.start;
    stop = camera.stop;
    getInfo = () => ({ label: 'FaceTime HD Camera', width: 640, height: 480 });
  },
}));
vi.mock('../src/vision/drawing', () => ({ drawSkeleton: vi.fn() }));

let listener: (m: any, sender: any, respond: (value: any) => void) => unknown;
const send = vi.fn(async (_message: any) => ({}));
const request = (type: string, payload: object = {}) =>
  new Promise<any>((resolve) =>
    listener({ target: 'offscreen', type, ...payload }, { id: 'test-extension' }, resolve),
  );
let clock = 1000;
function pushPreview() {
  camera.preview!({ displayWidth: 640, displayHeight: 480 } as VideoFrame, clock);
}
function push(valid = true, gap = 75, values = Array(12).fill(0)) {
  clock += gap;
  camera.packet!({
    time: clock,
    landmarks: landmarks(),
    frame: valid ? { t: clock, values } : null,
    quality: valid ? 0.9 : 0.2,
    message: valid
      ? 'Upper body tracked'
      : 'Keep both shoulders, elbows and wrists clearly visible.',
    width: 640,
    height: 480,
    fps: 15,
  });
  pushPreview();
}
function latest() {
  return send.mock.calls
    .map((call) => call[0] as any)
    .filter((m) => m.type === 'OFFSCREEN_STATUS')
    .at(-1);
}
function previews() {
  return send.mock.calls
    .map((call) => call[0] as any)
    .filter((m) => m.type === 'OFFSCREEN_PREVIEW');
}

function commands() {
  return send.mock.calls
    .map((call) => call[0] as any)
    .filter((message) => message.type === 'OFFSCREEN_COMMAND');
}

async function flushPreview() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

beforeAll(async () => {
  document.body.innerHTML = '<canvas id="preview"></canvas>';
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save() {},
    restore() {},
    translate() {},
    scale() {},
    drawImage() {},
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['preview'], { type: 'image/webp' })),
  );
  vi.stubGlobal(
    'FileReader',
    class {
      result = 'data:image/webp;base64,preview';
      onload: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    },
  );
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      getURL: (p: string) => `chrome-extension://test-extension${p}`,
      sendMessage: send,
      onMessage: {
        addListener: (f: typeof listener) => {
          listener = f;
        },
      },
    },
  });
  await import('../connector/src/offscreen');
});
beforeEach(async () => {
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  send.mockClear();
  await request('START', { gestures: [template()] });
});
afterEach(async () => {
  await request('STOP');
  vi.mocked(performance.now).mockRestore();
});

describe('background camera readiness', () => {
  it('waits for continuous valid frames before advertising readiness', async () => {
    push();
    expect(latest().poseReady).toBe(false);
    expect(latest().status.state).toBe('CHECKING_CAMERA');
    for (let i = 0; i < 10; i++) push();
    await flushPreview();
    expect(latest().poseReady).toBe(true);
    expect(previews()[0].preview).toBe('data:image/webp;base64,preview');
    expect(latest().preview).toBeUndefined();
    expect(latest().cameraLabel).toBe('FaceTime HD Camera');
  });
  it('can suspend preview work without pausing recognition', async () => {
    await request('PREVIEW_VISIBILITY', { enabled: false });
    send.mockClear();
    for (let i = 0; i < 12; i++) push();
    expect(latest().poseReady).toBe(true);
    expect(previews()).toHaveLength(0);
    await request('PREVIEW_VISIBILITY', { enabled: true });
    await Promise.resolve();
    push(true, 150);
    await flushPreview();
    expect(previews()).toHaveLength(1);
  });
  it('allows a live preview up to twenty frames per second without a growing queue', async () => {
    send.mockClear();
    pushPreview();
    await flushPreview();
    expect(previews()).toHaveLength(1);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenLastCalledWith(
      expect.any(Function),
      'image/webp',
      0.52,
    );
    clock += 25;
    pushPreview();
    await flushPreview();
    expect(previews()).toHaveLength(1);
    clock += 25;
    pushPreview();
    await flushPreview();
    expect(previews()).toHaveLength(2);
  });
  it('keeps recognizing if rendering a preview fails', async () => {
    await request('START', { gestures: [poseTemplate()] });
    vi.mocked(drawSkeleton).mockImplementationOnce(() => {
      throw new Error('Preview failed');
    });

    const pose = poseSequence()[0].values;
    push(true, 50, pose);
    await flushPreview();

    for (let index = 0; index < 10; index++) push(true, 50, pose);

    expect(commands()).toHaveLength(1);
    expect(send.mock.calls.some((call) => (call[0] as any).type === 'OFFSCREEN_ERROR')).toBe(false);
  });
  it('rechecks readiness after a gap rather than accepting stale tracking', () => {
    for (let i = 0; i < 12; i++) push();
    expect(latest().poseReady).toBe(true);
    push(true, 1000);
    expect(latest().poseReady).toBe(false);
    push(false, 1000);
    expect(latest().poseReady).toBe(false);
    expect(latest().poseMessage).toContain('wrists');
    expect(latest().status.state).toBe('NO_POSE');
  });
  it('keeps recognition paused even while new valid camera frames arrive', async () => {
    for (let i = 0; i < 12; i++) push();
    await request('PAUSE', { paused: true });
    for (let i = 0; i < 20; i++) push();
    expect(latest().status.state).toBe('PAUSED');
    expect(send.mock.calls.some((call) => (call[0] as any).type === 'OFFSCREEN_COMMAND')).toBe(
      false,
    );
  });
  it('keeps a pose-only session ready when background frames arrive once per second', async () => {
    await request('STOP');
    await request('START', { gestures: [poseTemplate()] });
    send.mockClear();

    const pose = poseSequence()[0].values;
    push(true, 1000, pose);
    expect(latest().poseReady).toBe(false);

    push(true, 1000, pose);
    expect(latest().poseReady).toBe(true);

    push(true, 1000, pose);
    await Promise.resolve();

    expect(send.mock.calls.some((call) => (call[0] as any).type === 'OFFSCREEN_COMMAND')).toBe(
      true,
    );
  });

  it('sends repeated commands when the user lowers their hand only during cooldown', async () => {
    await request('START', { gestures: [poseTemplate()] });
    await request('PREVIEW_VISIBILITY', { enabled: false });
    send.mockClear();

    const pose = poseSequence()[0].values;
    const neutral = sequence()[0].values;

    for (let index = 0; index < 4; index++) push(true, 50, neutral);
    for (let index = 0; index < 6; index++) push(true, 50, pose);
    expect(commands()).toHaveLength(1);

    for (let repeat = 0; repeat < 4; repeat++) {
      for (let index = 0; index < 6; index++) push(true, 50, neutral);
      for (let index = 0; index < 32; index++) push(true, 50, pose);
    }

    expect(commands()).toHaveLength(5);
    expect(commands().every((message) => message.event.command === 'NEXT_SLIDE')).toBe(true);
    expect(latest().recognizedCount).toBe(5);
  });

  it('does not lose its release latch when a wrist briefly leaves the frame', async () => {
    await request('START', { gestures: [poseTemplate()] });
    await request('PREVIEW_VISIBILITY', { enabled: false });
    send.mockClear();

    const pose = poseSequence()[0].values;
    const neutral = sequence()[0].values;

    for (let index = 0; index < 40; index++) push(true, 50, pose);
    expect(commands()).toHaveLength(1);

    push(false, 50);
    push(false, 50);
    for (let index = 0; index < 40; index++) push(true, 50, pose);
    expect(commands()).toHaveLength(1);

    for (let index = 0; index < 4; index++) push(true, 50, neutral);
    for (let index = 0; index < 10; index++) push(true, 50, pose);
    expect(commands()).toHaveLength(2);
  });
});
