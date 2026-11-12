import { BackgroundCamera } from './BackgroundCamera';
import { GestureRecognizer } from '../../src/core/recognizer';
import { validateTemplates } from '../../src/core/storage';
import { drawSkeleton } from '../../src/vision/drawing';
import type { Landmark } from '../../src/core/types';

let recognizer: GestureRecognizer | null = null;
let lastStatus = 0;
let lastState = '';
let lastPreview = 0;
let run = 0;
let readyFrames = 0;
let lastFrameTime = 0;
let readyFrameTarget = 3;
let readyFrameGap = 350;
let recognitionStarted = false;
let recognizedCount = 0;
let paused = false;
let previewEnabled = true;
let previewSending = false;
let latestPose: { time: number; landmarks: Landmark[] } | null = null;

const PREVIEW_INTERVAL_MS = 50;
const preview = document.getElementById('preview') as HTMLCanvasElement;
const skeleton = document.createElement('canvas');

function previewFrame(source: VideoFrame, time: number): Promise<string | null> {
  const width = 320;
  const height = Math.round((width * source.displayHeight) / source.displayWidth);

  if (preview.width !== width) preview.width = width;
  if (preview.height !== height) preview.height = height;
  if (skeleton.width !== width) skeleton.width = width;
  if (skeleton.height !== height) skeleton.height = height;

  const context = preview.getContext('2d', { alpha: false });
  if (!context) return Promise.resolve(null);

  context.save();

  try {
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(source, 0, 0, width, height);
    if (latestPose && time - latestPose.time <= 250) {
      drawSkeleton(skeleton, latestPose.landmarks);
      context.drawImage(skeleton, 0, 0);
    }
  } finally {
    context.restore();
  }

  return new Promise((resolve, reject) => {
    preview.toBlob(
      (blob) => {
        if (!blob) return resolve(null);

        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => reject(new Error('Could not prepare the live preview.'));
        reader.readAsDataURL(blob);
      },
      'image/webp',
      0.52,
    );
  });
}

function sendPreview(source: VideoFrame, time: number) {
  if (!previewEnabled || previewSending || time - lastPreview < PREVIEW_INTERVAL_MS) return;

  const token = run;
  lastPreview = time;
  previewSending = true;

  void (async () => {
    try {
      // Draw before the camera loop transfers or closes the VideoFrame.
      const frame = await previewFrame(source, time);
      if (frame && token === run && previewEnabled && recognizer) {
        await chrome.runtime.sendMessage({
          target: 'background',
          type: 'OFFSCREEN_PREVIEW',
          preview: frame,
        });
      }
    } catch {
      // A preview failure must not interrupt recognition or slide commands.
    } finally {
      if (token === run) previewSending = false;
    }
  })();
}

const camera = new BackgroundCamera(
  (packet) => {
    latestPose = { time: packet.time, landmarks: packet.landmarks };
    if (packet.frame) {
      readyFrames = packet.time - lastFrameTime <= readyFrameGap ? readyFrames + 1 : 1;
      lastFrameTime = packet.time;
    } else readyFrames = 0;

    const poseReady = readyFrames >= readyFrameTarget;

    if (!recognitionStarted && poseReady) {
      recognitionStarted = true;
      recognizer?.setEnabled(!paused);
    }

    const status = recognizer?.push(packet.frame, packet.time);
    const state = paused
      ? 'PAUSED'
      : !packet.frame
        ? 'NO_POSE'
        : !poseReady
          ? 'CHECKING_CAMERA'
          : (status?.state ?? 'READY');

    if (packet.time - lastStatus >= 650 || state !== lastState) {
      lastStatus = packet.time;
      lastState = state;

      const info = camera.getInfo();

      void chrome.runtime
        .sendMessage({
          target: 'background',
          type: 'OFFSCREEN_STATUS',
          status: { ...status, state },
          poseReady,
          poseMessage:
            packet.frame && !poseReady
              ? 'Upper body detected. Checking continuous camera frames…'
              : packet.message,
          poseQuality: packet.quality,
          recognitionFps: packet.fps,
          captureFps: info.captureFps,
          recognizedCount,
          cameraLabel: info.label,
          cameraWidth: info.width ?? packet.width,
          cameraHeight: info.height ?? packet.height,
        })
        .catch(() => {});
    }
  },
  (error) => {
    recognizer?.setEnabled(false);
    void chrome.runtime
      .sendMessage({ target: 'background', type: 'OFFSCREEN_ERROR', error })
      .catch(() => {});
  },
  sendPreview,
);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'offscreen') return;

  if (message.type === 'STOP') {
    run++;
    camera.stop();
    readyFrames = 0;
    recognitionStarted = false;
    previewSending = false;
    latestPose = null;
    recognizer?.setEnabled(false);
    recognizer = null;
    respond({ ok: true });
    return;
  }

  if (message.type === 'PAUSE') {
    paused = Boolean(message.paused);
    recognizer?.setEnabled(!paused && recognitionStarted);
    respond({ ok: true });
    return;
  }

  if (message.type === 'PREVIEW_VISIBILITY') {
    previewEnabled = Boolean(message.enabled);
    if (previewEnabled) lastPreview = 0;
    respond({ ok: true });
    return;
  }

  if (message.type === 'START') {
    const current = ++run;

    void (async () => {
      camera.stop();
      lastStatus = 0;
      lastState = '';
      lastPreview = 0;
      previewSending = false;
      latestPose = null;
      previewEnabled = true;
      readyFrames = 0;
      lastFrameTime = 0;
      recognitionStarted = false;
      recognizedCount = 0;
      paused = false;

      const templates = validateTemplates(message.gestures);
      const poseOnly = templates
        .filter((gesture) => gesture.enabled)
        .every((gesture) => gesture.mode === 'pose');

      readyFrameTarget = poseOnly ? 2 : 3;
      readyFrameGap = poseOnly ? 1600 : 350;

      recognizer = new GestureRecognizer(
        templates,
        (event) => {
          recognizedCount++;

          if (event.command === 'TOGGLE_CONTROL') {
            paused = true;
            recognizer?.setEnabled(false);
          }

          void chrome.runtime
            .sendMessage({ target: 'background', type: 'OFFSCREEN_COMMAND', event })
            .catch(() => {});
        },
        { releaseDuringCooldown: true },
      );

      await camera.start(chrome.runtime.getURL('/'));
      respond(current === run ? { ok: true } : { error: 'Camera check cancelled.' });
    })().catch((error) => {
      if (current === run) camera.stop();
      respond({ error: (error as Error).message });
    });

    return true;
  }
});
