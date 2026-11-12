import { dtwDistance, resample, distanceToScore } from './dtw';
import {
  FEATURE_SIZE,
  frameDistance,
  motionEnergy,
  relativeSequence,
  representativePose,
} from './normalize';
import type { Command, GestureTemplate, PoseSequence } from './types';

function validateFrames(frames: PoseSequence): string | null {
  if (
    frames.some(
      (frame, i) =>
        !Number.isFinite(frame.t) ||
        (i > 0 && frame.t <= frames[i - 1].t) ||
        !Array.isArray(frame.values) ||
        frame.values.length !== FEATURE_SIZE ||
        frame.values.some((value) => !Number.isFinite(value)),
    )
  )
    return 'Some pose data was incomplete. Keep both arms visible and try again.';

  return null;
}

export function validateRecording(frames: PoseSequence): string | null {
  if (frames.length < 12)
    return 'Too few valid frames. Improve the lighting, keep both arms in view, and record again.';

  const frameError = validateFrames(frames);
  if (frameError) return frameError;

  const duration = frames.at(-1)!.t - frames[0].t;
  if (duration < 650 || duration > 2150)
    return 'The recorded movement should last about 0.7–2 seconds. Please record again.';
  if (frames.some((f, i) => i > 0 && f.t - frames[i - 1].t > 300))
    return 'Tracking was lost for over 0.3 seconds during recording. Please try again.';
  if (motionEnergy(frames) < 0.065)
    return 'Too little movement. Record a clear body gesture rather than holding a neutral stance.';
  return null;
}

export function validatePoseCapture(frames: PoseSequence): string | null {
  if (frames.length < 4)
    return 'Too few clear camera frames. Hold the pose still and capture it again.';

  const frameError = validateFrames(frames);
  if (frameError) return frameError;

  const duration = frames.at(-1)!.t - frames[0].t;
  if (duration < 250 || duration > 1100)
    return 'Hold the pose for about half a second, then capture it again.';

  if (frames.some((frame, i) => i > 0 && frame.t - frames[i - 1].t > 400))
    return 'Tracking paused while the pose was captured. Keep both arms visible and try again.';

  const pose = representativePose(frames);
  const spread = Math.max(...frames.map((frame) => frameDistance(frame.values, pose)));
  if (spread > 0.16) return 'You moved too much during capture. Choose one pose and hold it still.';

  return null;
}

export function compareRecordings(a: PoseSequence, b: PoseSequence) {
  const firstError = validateRecording(a),
    secondError = validateRecording(b);
  if (firstError || secondError)
    throw new Error(firstError || secondError || 'Could not compare the recordings.');
  const distance = dtwDistance(resample(a), resample(b));
  if (!Number.isFinite(distance))
    throw new Error('The two recordings could not be compared. Please record take 2 again.');
  return { distance, score: distanceToScore(distance), accepted: distance <= 0.32 };
}

export function makeGesture(
  name: string,
  command: Command,
  a: PoseSequence,
  b: PoseSequence,
  cooldownMs: number,
): GestureTemplate {
  for (const frames of [a, b]) {
    const error = validateRecording(frames);
    if (error) throw new Error(error);
  }
  const comparison = compareRecordings(a, b);
  if (!comparison.accepted)
    throw new Error(
      'The two takes differ too much. Record again with a similar starting pose and movement path.',
    );
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 40),
    command,
    mode: 'motion',
    samples: [relativeSequence(resample(a)), relativeSequence(resample(b))],
    threshold: Math.max(0.18, Math.min(0.38, comparison.distance * 1.6 + 0.1)),
    cooldownMs,
    createdAt: new Date().toISOString(),
    enabled: true,
  };
}

export function makePoseGesture(
  name: string,
  command: Command,
  frames: PoseSequence,
  cooldownMs: number,
): GestureTemplate {
  const error = validatePoseCapture(frames);
  if (error) throw new Error(error);

  const sample = relativeSequence(frames);
  const pose = representativePose(sample);
  const spread = Math.max(...sample.map((frame) => frameDistance(frame.values, pose)));

  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 40),
    command,
    mode: 'pose',
    samples: [
      sample.map((frame) => ({ ...frame, values: [...frame.values] })),
      sample.map((frame) => ({ ...frame, values: [...frame.values] })),
    ],
    threshold: Math.max(0.2, Math.min(0.3, 0.18 + spread * 2.5)),
    cooldownMs,
    createdAt: new Date().toISOString(),
    enabled: true,
  };
}

function distanceBetweenTemplates(a: GestureTemplate, b: GestureTemplate) {
  if (a.mode === 'pose' && b.mode === 'pose') {
    const aPose = representativePose(a.samples[0]);
    const bPose = representativePose(b.samples[0]);

    return frameDistance(aPose, bPose);
  }

  if (a.mode === 'pose' || b.mode === 'pose') {
    const pose =
      a.mode === 'pose' ? representativePose(a.samples[0]) : representativePose(b.samples[0]);
    const motion = a.mode === 'pose' ? b : a;

    return Math.min(...motion.samples.map((sample) => frameDistance(pose, sample.at(-1)!.values)));
  }

  return Math.min(
    ...a.samples.flatMap((first) => b.samples.map((second) => dtwDistance(first, second))),
  );
}

export function findConflict(candidate: GestureTemplate, existing: GestureTemplate[]) {
  for (const other of existing) {
    if (other.id === candidate.id || !other.enabled) continue;

    const distance = distanceBetweenTemplates(candidate, other);
    if (distance < Math.max(candidate.threshold, other.threshold) + 0.06)
      return { gesture: other, score: distanceToScore(distance) };
  }
  return null;
}
