import { BackgroundCamera } from '../../connector/src/BackgroundCamera';

interface TrackGenerator extends MediaStreamTrack {
  writable: WritableStream<VideoFrame>;
}

const start = document.getElementById('start') as HTMLButtonElement;
const result = document.getElementById('result')!;

start.onclick = async () => {
  start.disabled = true;

  const Generator = (
    globalThis as typeof globalThis & {
      MediaStreamTrackGenerator?: new (options: { kind: string }) => TrackGenerator;
    }
  ).MediaStreamTrackGenerator;

  if (!Generator) {
    result.textContent =
      'This Chrome build does not expose MediaStreamTrackGenerator for this test.';
    start.disabled = false;
    return;
  }

  const track = new Generator({ kind: 'video' });
  const stream = new MediaStream([track]);
  const originalDevices = navigator.mediaDevices;
  const original = originalDevices?.getUserMedia;
  const producer = new Worker(new URL('./frame-source.js', import.meta.url));

  if (!originalDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
  } else originalDevices.getUserMedia = async () => stream;
  result.textContent = 'Loading the local pose model…';

  let startedAt = 0;
  let count = 0;
  let hiddenFrames = 0;
  let latestFps = 0;

  const finish = (error?: string) => {
    camera.stop();
    producer.terminate();
    if (originalDevices && original) originalDevices.getUserMedia = original;
    else Reflect.deleteProperty(navigator, 'mediaDevices');
    start.disabled = false;

    const elapsed = Math.max(1, performance.now() - startedAt);
    const message = error?.includes('activeTexture')
      ? 'This browser could not create a WebGL context for the pose model. Run this check in your desktop Chrome.'
      : error;

    result.textContent =
      message ||
      JSON.stringify(
        {
          result: hiddenFrames > 100 && latestFps >= 10 ? 'PASS' : 'CHECK RESULTS',
          processedFrames: count,
          processedWhileHidden: hiddenFrames,
          measuredFps: latestFps,
          averageFps: +((count * 1000) / elapsed).toFixed(1),
          elapsedSeconds: +(elapsed / 1000).toFixed(1),
        },
        null,
        2,
      );
  };

  const camera = new BackgroundCamera(
    (packet) => {
      count++;
      if (document.hidden) hiddenFrames++;
      latestFps = packet.fps;

      if (packet.time - startedAt >= 12_000) finish();
      else
        result.textContent = `Running: ${count} frames, ${hiddenFrames} while hidden, ${latestFps} FPS`;
    },
    (error) => finish(error),
  );

  try {
    await camera.start(new URL('/connector/dist/', location.href).href);
    startedAt = performance.now();
    producer.postMessage({ writable: track.writable }, [track.writable]);
  } catch (error) {
    finish((error as Error).message);
  }
};
