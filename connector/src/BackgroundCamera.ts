import type { PosePacket } from '../../src/core/types';
import { FrameRate } from '../../src/vision/FrameRate';
import type { PoseWorkerReply, PoseWorkerRequest } from './pose-worker';

interface TrackProcessorConstructor {
  new (options: { track: MediaStreamTrack; maxBufferSize: number }): {
    readable: ReadableStream<VideoFrame>;
  };
}

const FRAME_INTERVAL_MS = 50;

export class BackgroundCamera {
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private workerReady = false;
  private pendingSince: number | null = null;
  private workerStartedAt = 0;
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private generation = 0;
  private running = false;
  private lastFrameAt = 0;
  private nextFrameAt = 0;
  private lastTimestamp = -Infinity;
  private captureRate = new FrameRate();
  private recognitionRate = new FrameRate();

  constructor(
    private onPacket: (packet: PosePacket) => void,
    private onError: (message: string) => void,
    private onCameraFrame?: (frame: VideoFrame, time: number) => void,
  ) {}

  async start(assetBase: string) {
    this.stop();

    const token = this.generation;
    const Processor = (
      globalThis as typeof globalThis & { MediaStreamTrackProcessor?: TrackProcessorConstructor }
    ).MediaStreamTrackProcessor;

    if (!Processor)
      throw new Error(
        'Direct background camera capture is unavailable. Update desktop Chrome and reload the connector.',
      );

    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        'Camera access is unavailable. Open GestureDeck in desktop Chrome at localhost.',
      );

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 480 },
          height: { ideal: 360 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      if (token !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;

      const track = stream.getVideoTracks()[0];
      const processor = new Processor({ track, maxBufferSize: 1 });
      const reader = processor.readable.getReader();

      this.reader = reader;
      this.running = true;
      this.lastFrameAt = performance.now();
      this.nextFrameAt = 0;
      this.lastTimestamp = -Infinity;
      this.startWorker(assetBase, token);

      track.onended = () => {
        if (this.running) this.fail('The camera disconnected. Restart the camera check.');
      };

      this.watchdog = setInterval(() => {
        const now = performance.now();
        if (now - this.lastFrameAt > 8000)
          this.fail('The camera stopped delivering frames. Restart the camera check.');
        else if (!this.workerReady && now - this.workerStartedAt > 30_000)
          this.fail('The pose model did not finish loading. Restart the camera check.');
        else if (this.pendingSince !== null && now - this.pendingSince > 8000)
          this.fail('Pose recognition stopped responding. Restart the camera check.');
      }, 1000);

      void this.consume(reader, token);
    } catch (exception) {
      if (token !== this.generation) return;

      this.stop();

      const error = exception as Error;

      if (error.name === 'NotAllowedError')
        throw new Error(
          'Allow the connector to use the camera in Chrome and your system privacy settings.',
        );
      if (error.name === 'NotReadableError')
        throw new Error(
          'The camera is busy. Close other camera apps, then restart the camera check.',
        );

      throw error;
    }
  }

  getInfo() {
    const track = this.stream?.getVideoTracks()[0];
    const settings = track?.getSettings();

    return {
      label: track?.label || 'Camera',
      width: settings?.width,
      height: settings?.height,
      captureFps: this.captureRate.get(performance.now()),
    };
  }

  private startWorker(assetBase: string, token: number) {
    const worker = new Worker(new URL('pose-worker.js', assetBase));
    this.worker = worker;
    this.workerStartedAt = performance.now();
    worker.onmessage = ({ data }: MessageEvent<PoseWorkerReply>) => {
      if (token !== this.generation) return;
      if (data.type === 'READY') this.workerReady = true;
      if (data.type === 'ERROR') this.fail(`Background recognition stopped: ${data.message}`);
      if (data.type === 'POSE') {
        this.pendingSince = null;
        const now = performance.now();
        this.recognitionRate.add(now);
        this.onPacket({ ...data.packet, fps: this.recognitionRate.get(now) });
      }
    };
    worker.onerror = (error) => {
      if (token === this.generation)
        this.fail(`Could not run the background pose model: ${error.message}`);
    };
    const request: PoseWorkerRequest = { type: 'INIT', assetBase };
    worker.postMessage(request);
  }

  private async consume(reader: ReadableStreamDefaultReader<VideoFrame>, token: number) {
    try {
      while (this.running && token === this.generation) {
        const { value: frame, done } = await reader.read();

        if (done) {
          if (token === this.generation && this.running)
            this.fail('The camera stream ended. Restart the camera check.');
          return;
        }

        let transferred = false;
        try {
          if (!this.running || token !== this.generation) return;

          const now = performance.now();
          this.lastFrameAt = now;

          if (frame.timestamp <= this.lastTimestamp || !frame.displayWidth || !frame.displayHeight)
            continue;
          this.lastTimestamp = frame.timestamp;
          this.captureRate.add(now);
          this.onCameraFrame?.(frame, now);

          if (!this.workerReady || this.pendingSince !== null || now < this.nextFrameAt) continue;

          this.nextFrameAt =
            now - this.nextFrameAt > FRAME_INTERVAL_MS
              ? now + FRAME_INTERVAL_MS
              : this.nextFrameAt + FRAME_INTERVAL_MS;
          this.pendingSince = now;
          const request: PoseWorkerRequest = { type: 'FRAME', frame, time: now };
          this.worker!.postMessage(request, [frame]);
          transferred = true;
        } finally {
          if (!transferred) frame.close();
        }
      }
    } catch (exception) {
      if (token === this.generation && this.running)
        this.fail(`Background recognition stopped: ${(exception as Error).message}`);
    } finally {
      reader.releaseLock();
    }
  }

  private fail(message: string) {
    this.stop();
    this.onError(message);
  }

  stop() {
    this.generation++;
    this.running = false;
    clearInterval(this.watchdog);
    this.watchdog = undefined;

    const reader = this.reader;
    this.reader = null;
    if (reader) void reader.cancel().catch(() => {});

    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = null;

    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
    this.pendingSince = null;
    this.captureRate.reset();
    this.recognitionRate.reset();
  }
}
