import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { normalizePose } from '../core/normalize';
import type { PosePacket } from '../core/types';

interface PoseCameraOptions {
  canvasFrames?: boolean;
}

export class PoseCamera {
  private model: PoseLandmarker | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private videoCallback: number | undefined;
  private generation = 0;
  private running = false;
  private lastVideoTime = -1;
  private sourceCanvas: HTMLCanvasElement | null = null;
  private lastFrameAt = 0;
  private lastProcessedAt = -Infinity;
  private frameTimes: number[] = [];
  constructor(
    private video: HTMLVideoElement,
    private onPacket: (packet: PosePacket) => void,
    private onError: (error: string) => void,
    private options: PoseCameraOptions = {},
  ) {}

  async start(assetBase: string): Promise<void> {
    this.stop();
    const token = this.generation;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera access requires localhost or HTTPS. Desktop Chrome is recommended.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
        audio: false,
      });
      if (token !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();
      const vision = await FilesetResolver.forVisionTasks(new URL('wasm', assetBase).href);
      const model = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: new URL('models/pose_landmarker_lite.task', assetBase).href,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.6,
        minPosePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      if (token !== this.generation) {
        model.close();
        return;
      }
      this.model = model;
      this.running = true;
      this.lastVideoTime = -1;
      this.lastFrameAt = performance.now();
      this.lastProcessedAt = -Infinity;
      this.frameTimes = [];
      stream.getVideoTracks()[0].onended = () => {
        if (this.running) {
          this.stop();
          this.onError('The camera disconnected. Please start it again.');
        }
      };
      this.scheduleFrame();
    } catch (error) {
      if (token !== this.generation) return;
      this.stop();
      const e = error as Error;
      if (e.name === 'NotAllowedError')
        throw new Error(
          'Camera access was denied. Allow it in your browser site settings and system privacy settings.',
        );
      if (e.name === 'NotFoundError')
        throw new Error('No camera found. Connect a camera and try again.');
      if (e.name === 'NotReadableError')
        throw new Error('Could not read the camera. Close other apps using it and try again.');
      throw new Error(`Could not start the camera or local model: ${e.message}`);
    }
  }
  private scheduleFrame() {
    if (!this.running) return;

    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.videoCallback = this.video.requestVideoFrameCallback(this.onVideoFrame);
      clearTimeout(this.watchdog);
      this.watchdog = setTimeout(this.onVideoWatchdog, 900);
      return;
    }

    this.timer = setTimeout(this.loop, 0);
  }

  private onVideoFrame = (now: number) => {
    this.videoCallback = undefined;
    clearTimeout(this.watchdog);
    this.watchdog = undefined;

    this.processFrame(now);

    if (this.running) this.scheduleFrame();
  };

  private onVideoWatchdog = () => {
    this.watchdog = undefined;

    if (this.videoCallback !== undefined) {
      this.video.cancelVideoFrameCallback(this.videoCallback);
      this.videoCallback = undefined;
    }

    this.processFrame(performance.now());

    if (this.running) this.scheduleFrame();
  };

  private loop = () => {
    if (!this.running || !this.model) return;

    const begin = performance.now();

    this.processFrame(begin);

    if (this.running)
      this.timer = setTimeout(this.loop, Math.max(5, 66 - (performance.now() - begin)));
  };

  private processFrame(begin: number) {
    if (!this.running || !this.model) return;

    try {
      if (
        this.video.readyState >= 2 &&
        this.video.videoWidth > 0 &&
        this.video.videoHeight > 0 &&
        this.video.currentTime !== this.lastVideoTime &&
        begin - this.lastProcessedAt >= 58
      ) {
        this.lastVideoTime = this.video.currentTime;
        this.lastFrameAt = begin;
        this.lastProcessedAt = begin;

        const width = this.video.videoWidth || 640;
        const height = this.video.videoHeight || 480;
        let source: HTMLVideoElement | HTMLCanvasElement = this.video;

        if (this.options.canvasFrames) {
          this.sourceCanvas ??= this.video.ownerDocument.createElement('canvas');
          if (this.sourceCanvas.width !== width) this.sourceCanvas.width = width;
          if (this.sourceCanvas.height !== height) this.sourceCanvas.height = height;

          const context = this.sourceCanvas.getContext('2d', { alpha: false });
          if (!context) throw new Error('Could not prepare the background camera frame.');

          context.drawImage(this.video, 0, 0, width, height);
          source = this.sourceCanvas;
        }

        const result = this.model.detectForVideo(source, begin);
        const landmarks = result.landmarks[0] ?? [];
        const normalized = normalizePose(landmarks, begin, width / height);

        this.frameTimes.push(begin);
        this.frameTimes = this.frameTimes.filter((time) => begin - time <= 1200);

        const firstFrame = this.frameTimes[0] ?? begin;
        const measuredFps =
          this.frameTimes.length > 1
            ? ((this.frameTimes.length - 1) * 1000) / Math.max(1, begin - firstFrame)
            : 0;

        this.onPacket({
          time: begin,
          landmarks,
          ...normalized,
          fps: Math.round(measuredFps),
          width,
          height,
        });
      } else if (begin - this.lastFrameAt > 8000) {
        throw new Error(
          'The camera opened but stopped delivering video frames. Stop control and restart the camera check.',
        );
      }
    } catch (error) {
      this.stop();
      this.onError(`Recognition stopped: ${(error as Error).message}`);
    }
  }

  stop() {
    this.generation++;
    this.running = false;
    clearTimeout(this.timer);
    clearTimeout(this.watchdog);

    if (this.videoCallback !== undefined) {
      try {
        this.video.cancelVideoFrameCallback(this.videoCallback);
      } catch {
        /* detached video */
      }
    }

    this.videoCallback = undefined;
    this.stream?.getTracks().forEach((t) => {
      try {
        t.onended = null;
        t.stop();
      } catch {
        /* already stopped */
      }
    });
    this.stream = null;
    try {
      this.video.srcObject = null;
    } catch {
      /* detached video */
    }
    try {
      this.model?.close();
    } catch {
      /* already closed by MediaPipe */
    }
    this.model = null;
    this.sourceCanvas = null;
    this.frameTimes = [];
  }
}
