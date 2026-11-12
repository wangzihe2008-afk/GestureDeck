import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { normalizePose } from '../../src/core/normalize';
import type { Landmark, PosePacket } from '../../src/core/types';

type Delegate = 'CPU' | 'GPU';

export type PoseWorkerRequest =
  | { type: 'INIT'; assetBase: string }
  | { type: 'FRAME'; frame: VideoFrame; time: number };

export type PoseWorkerReply =
  | { type: 'READY' }
  | { type: 'POSE'; packet: Omit<PosePacket, 'fps'> }
  | { type: 'ERROR'; message: string };

let model: PoseLandmarker | null = null;
let delegate: Delegate = 'GPU';
let assetBase = '';

async function createModel(nextDelegate: Delegate) {
  const vision = await FilesetResolver.forVisionTasks(new URL('wasm', assetBase).href);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: new URL('models/pose_landmarker_lite.task', assetBase).href,
      delegate: nextDelegate,
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.6,
    minPosePresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
}

async function useCpu() {
  try {
    model?.close();
  } catch {
    // The GPU context may already have been lost.
  }
  model = null;
  delegate = 'CPU';
  model = await createModel(delegate);
}

function detect(frame: VideoFrame, time: number) {
  let landmarks: Landmark[] = [];
  model!.detectForVideo(frame, time, (result) => {
    landmarks = result.landmarks[0] ?? [];
  });
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  return { time, landmarks, width, height, ...normalizePose(landmarks, time, width / height) };
}

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<PoseWorkerRequest>) => void) | null;
  postMessage: (reply: PoseWorkerReply) => void;
};

worker.onmessage = ({ data }) => {
  void (async () => {
    if (data.type === 'INIT') {
      assetBase = data.assetBase;
      try {
        model = await createModel(delegate);
      } catch {
        await useCpu();
      }
      worker.postMessage({ type: 'READY' });
      return;
    }

    try {
      let packet;
      try {
        packet = detect(data.frame, data.time);
      } catch (error) {
        if (delegate !== 'GPU') throw error;
        await useCpu();
        packet = detect(data.frame, data.time);
      }
      worker.postMessage({ type: 'POSE', packet });
    } finally {
      data.frame.close();
    }
  })().catch((error: Error) => worker.postMessage({ type: 'ERROR', message: error.message }));
};
