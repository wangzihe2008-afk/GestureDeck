import { dtwDistance, distanceToScore, resample } from './dtw';
import { frameDistance, representativePose } from './normalize';
import type {
  GestureTemplate,
  Match,
  PoseFrame,
  PoseSequence,
  RecognitionEvent,
  RecognitionStatus,
} from './types';

export class GestureRecognizer {
  private buffer: PoseSequence = [];
  private lastFrame = -Infinity;
  private lastCheck = -Infinity;
  private cooldownUntil = 0;
  private released = true;
  private releaseCount = 0;
  private releasePose: number[] | null = null;
  private releaseStartPoses: number[][] = [];
  private releaseDistance = 0.18;
  private releaseStartTolerance = 0.18;
  private releaseRequiredFrames = 3;
  private candidate = '';
  private candidateSince = 0;
  private confirmations = 0;
  private enabled = false;
  status: RecognitionStatus = { state: 'PAUSED', candidate: '', score: 0, progress: 0 };

  constructor(
    private gestures: GestureTemplate[],
    private onCommand: (event: RecognitionEvent) => void,
    private options: { releaseDuringCooldown?: boolean } = {},
  ) {}
  setTemplates(gestures: GestureTemplate[]) {
    this.gestures = gestures;
    this.reset();
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.reset();
  }
  isEnabled() {
    return this.enabled;
  }
  reset() {
    this.buffer = [];
    this.lastFrame = -Infinity;
    this.lastCheck = -Infinity;
    this.candidate = '';
    this.candidateSince = 0;
    this.confirmations = 0;
    this.released = true;
    this.releasePose = null;
    this.releaseStartPoses = [];
    this.releaseCount = 0;
    this.releaseDistance = 0.18;
    this.releaseStartTolerance = 0.18;
    this.releaseRequiredFrames = 3;
    this.cooldownUntil = 0;
    this.status = {
      state: this.enabled ? 'READY' : 'PAUSED',
      candidate: '',
      score: 0,
      progress: 0,
    };
  }

  push(frame: PoseFrame | null, now: number): RecognitionStatus {
    if (!this.enabled)
      return (this.status = { state: 'PAUSED', candidate: '', score: 0, progress: 0 });
    if (!frame) {
      this.buffer = [];
      this.resetMatching();
      return (this.status = { state: 'NO_POSE', candidate: '', score: 0, progress: 0 });
    }

    const frameGap = frame.t - this.lastFrame;
    if (frameGap > 300) {
      this.buffer = [];

      const candidateGesture = this.gestures.find((gesture) => gesture.id === this.candidate);
      if (candidateGesture?.mode !== 'pose') this.resetMatching();
    }
    if (frameGap > 1800) this.resetMatching();

    this.lastFrame = frame.t;

    const coolingDown = now < this.cooldownUntil;

    if (coolingDown && !this.options.releaseDuringCooldown)
      return (this.status = { state: 'COOLDOWN', candidate: '', score: 0, progress: 0 });

    if (!this.released && this.releasePose) {
      const distanceFromEnd = frameDistance(frame.values, this.releasePose);
      const returnedToStart = this.releaseStartPoses.some((startPose) => {
        const distanceFromStart = frameDistance(frame.values, startPose);
        return (
          distanceFromStart <= this.releaseStartTolerance &&
          distanceFromStart + 0.04 < distanceFromEnd
        );
      });
      const leftEndPose = distanceFromEnd >= this.releaseDistance;

      this.releaseCount = returnedToStart || leftEndPose ? this.releaseCount + 1 : 0;

      if (this.releaseCount < this.releaseRequiredFrames)
        return (this.status = {
          state: coolingDown ? 'COOLDOWN' : 'RELEASE',
          candidate: '',
          score: 0,
          progress: 0,
        });

      this.released = true;
      this.buffer = [];
      this.releaseCount = 0;
      this.releasePose = null;
      this.releaseStartPoses = [];
      this.resetMatching();
    }

    if (coolingDown)
      return (this.status = { state: 'COOLDOWN', candidate: '', score: 0, progress: 0 });

    this.buffer.push(frame);
    this.buffer = this.buffer.filter((f) => frame.t - f.t <= 2400);

    if (now - this.lastCheck < 80) return this.status;

    this.lastCheck = now;
    const matches = this.match(frame);
    const best = matches[0];

    const mode = best?.gesture.mode ?? 'motion';
    const requiredMargin = mode === 'pose' ? 0.045 : 0.055;

    if (!best || best.distance > best.gesture.threshold || best.margin < requiredMargin) {
      this.resetMatching();

      return (this.status = {
        state: 'READY',
        candidate: best?.gesture.name ?? '',
        score: best?.score ?? 0,
        progress: 0,
      });
    }

    if (this.candidate === best.gesture.id) {
      this.confirmations++;
    } else {
      this.candidate = best.gesture.id;
      this.candidateSince = now;
      this.confirmations = 1;
    }

    this.candidate = best.gesture.id;

    const heldFor = now - this.candidateSince;
    const confirmed =
      mode === 'pose' ? this.confirmations >= 2 && heldFor >= 180 : this.confirmations >= 2;

    this.status = {
      state: 'MATCHING',
      candidate: best.gesture.name,
      score: best.score,
      progress:
        mode === 'pose'
          ? Math.min(1, Math.max(this.confirmations / 3, heldFor / 180))
          : this.confirmations / 2,
    };

    if (confirmed) {
      this.cooldownUntil = now + best.gesture.cooldownMs;
      this.released = false;
      this.releasePose = [...frame.values];

      if (mode === 'pose') {
        this.releaseStartPoses = [];
        this.releaseDistance = Math.min(0.36, Math.max(0.24, best.gesture.threshold * 1.25));
        this.releaseStartTolerance = 0.18;
        this.releaseRequiredFrames = 2;
      } else {
        const endpointDistances = best.gesture.samples.map((sample) =>
          frameDistance(sample[0].values, sample.at(-1)!.values),
        );
        const endpointTravel = Math.min(...endpointDistances.filter(Number.isFinite));

        this.releaseStartPoses = best.gesture.samples.map((sample) => [...sample[0].values]);
        this.releaseDistance = Math.min(0.24, Math.max(0.1, endpointTravel * 0.45));
        this.releaseStartTolerance = Math.min(0.2, Math.max(0.1, endpointTravel * 0.35));
        this.releaseRequiredFrames = 3;
      }

      this.releaseCount = 0;
      this.buffer = [];
      this.resetMatching();
      this.status = {
        state: 'COOLDOWN',
        candidate: best.gesture.name,
        score: best.score,
        progress: 1,
      };
      this.onCommand({
        command: best.gesture.command,
        name: best.gesture.name,
        score: best.score,
        time: Date.now(),
      });
    }
    return this.status;
  }

  private resetMatching() {
    this.candidate = '';
    this.candidateSince = 0;
    this.confirmations = 0;
  }

  private match(frame: PoseFrame): Match[] {
    const matches: Match[] = [];

    for (const gesture of this.gestures.filter((g) => g.enabled)) {
      let distance = Infinity;

      if (gesture.mode === 'pose') {
        const distances = gesture.samples.map((sample) =>
          frameDistance(frame.values, representativePose(sample)),
        );

        distance = distances.reduce((total, value) => total + value, 0) / distances.length;
      } else {
        for (const sample of gesture.samples) {
          const duration = sample.at(-1)!.t;

          for (const ratio of [0.65, 0.85, 1, 1.2]) {
            const end = this.buffer.at(-1)?.t ?? 0;
            const window = this.buffer.filter((f) => f.t >= end - duration * ratio);

            if (window.length < 10 || window.at(-1)!.t - window[0].t < duration * ratio * 0.8)
              continue;

            const startDistance = frameDistance(window[0].values, sample[0].values);
            const endDistance = frameDistance(window.at(-1)!.values, sample.at(-1)!.values);

            if (endDistance > Math.min(0.28, gesture.threshold * 0.9) || startDistance > 0.35)
              continue;

            const endpoint = (startDistance + endDistance) / 2;

            distance = Math.min(
              distance,
              dtwDistance(resample(window), sample) * 0.8 + endpoint * 0.2,
            );
          }
        }
      }

      if (Number.isFinite(distance))
        matches.push({ gesture, distance, score: distanceToScore(distance), margin: Infinity });
    }

    matches.sort((a, b) => a.distance - b.distance);

    if (matches.length > 1) matches[0].margin = matches[1].distance - matches[0].distance;

    return matches;
  }
}
