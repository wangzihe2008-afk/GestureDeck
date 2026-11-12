import { describe, it, expect } from 'vitest';
import { normalizePose, motionEnergy } from '../src/core/normalize';
import { dtwDistance, resample } from '../src/core/dtw';
import {
  compareRecordings,
  findConflict,
  makeGesture,
  makePoseGesture,
  validatePoseCapture,
  validateRecording,
} from '../src/core/trainer';
import { GestureRecognizer } from '../src/core/recognizer';
import { parseProfile, validateTemplates } from '../src/core/storage';
import { landmarks, poseSequence, poseTemplate, sequence, template } from './fixtures';
import type { GestureTemplate, RecognitionEvent } from '../src/core/types';

describe('body-coordinate normalization', () => {
  it('ignores translation and uniform changes in body size', () => {
    const a = landmarks();
    const b = a.map((p) => ({ ...p, x: (p.x - 0.5) * 0.7 + 0.43, y: (p.y - 0.3) * 0.7 + 0.35 }));
    expect(normalizePose(a, 0).frame!.values).toEqual(
      expect.arrayContaining(normalizePose(b, 0).frame!.values.map((v) => expect.closeTo(v, 6))),
    );
  });
  it('rejects occluded wrists and missing people', () => {
    const a = landmarks();
    a[16].visibility = 0.2;
    expect(normalizePose(a, 0).frame).toBeNull();
    expect(normalizePose([], 0).frame).toBeNull();
  });
  it('rejects clipped arms and very small shoulders', () => {
    const a = landmarks();
    a[15].x = 0.001;
    expect(normalizePose(a, 0).frame).toBeNull();
    const b = landmarks();
    b[11].x = 0.49;
    b[12].x = 0.51;
    expect(normalizePose(b, 0).frame).toBeNull();
  });
  it('corrects non-square image aspect', () => {
    const a = landmarks();
    const b = a.map((p) => ({ ...p, x: (p.x - 0.5) * 0.75 + 0.5 }));
    const aa = normalizePose(a, 0, 4 / 3).frame!.values;
    const bb = normalizePose(b, 0, 16 / 9).frame!.values;
    aa.forEach((v, i) => expect(v).toBeCloseTo(bb[i], 6));
  });
  it('rejects non-finite confidence and falls back from an invalid aspect ratio', () => {
    const a = landmarks();
    a[16].visibility = NaN;
    expect(normalizePose(a, 0).frame).toBeNull();
    const b = normalizePose(landmarks(), 0, NaN);
    expect(b.frame).not.toBeNull();
    expect(b.frame!.values.every(Number.isFinite)).toBe(true);
  });
});
describe('DTW and recording validation', () => {
  it('matches different sampling rates and mildly varying speeds', () => {
    const a = sequence(30);
    const b = sequence(19, 1200);
    expect(dtwDistance(resample(a), resample(b))).toBeLessThan(0.001);
    const warped = sequence().map((f, i) => ({
      ...f,
      values: sequence()[Math.round((i / 23) ** 1.2 * 23)].values,
    }));
    expect(dtwDistance(a, warped)).toBeLessThan(0.12);
  });
  it('distinguishes reversed gestures', () => {
    expect(dtwDistance(sequence(), sequence(24, 1800, true))).toBeGreaterThan(0.4);
  });
  it('does not turn a neutral stance into a dynamic gesture', () => {
    const still = sequence().map((f) => ({ ...f, values: sequence()[0].values }));
    expect(motionEnergy(still)).toBeLessThan(1e-10);
    expect(validateRecording(still)).toMatch(/Too little movement/);
  });
  it('rejects tracking gaps', () => {
    const gap = sequence().map((f, i) => ({ ...f, t: f.t + (i > 10 ? 500 : 0) }));
    expect(validateRecording(gap)).not.toBeNull();
  });
  it('rejects incomplete frame data before comparing recordings', () => {
    const broken = sequence();
    broken[8] = { ...broken[8], values: broken[8].values.slice(0, -1) };
    expect(validateRecording(broken)).toMatch(/incomplete/);
    expect(() => compareRecordings(sequence(), broken)).toThrow(/incomplete/);
  });
  it('requires repeatable recordings and detects conflicts', () => {
    expect(compareRecordings(sequence(), sequence()).accepted).toBe(true);
    expect(compareRecordings(sequence(), sequence(24, 1800, true)).accepted).toBe(false);
    expect(findConflict({ ...template(), id: 'duplicate' }, [template()])?.gesture.id).toBe(
      'right',
    );
  });
  it('creates a bounded valid two-template profile', () => {
    const g = makeGesture('My gesture', 'NEXT_SLIDE', sequence(), sequence(), 1200);
    expect(g.samples).toHaveLength(2);
    expect(g.threshold).toBeGreaterThanOrEqual(0.18);
    expect(validateTemplates([g])).toHaveLength(1);
  });
  it('captures one stable pose and rejects a moving sequence', () => {
    expect(validatePoseCapture(poseSequence())).toBeNull();
    expect(validatePoseCapture(sequence(8, 600))).toMatch(/moved too much/);

    const pose = makePoseGesture('Raised arm', 'NEXT_SLIDE', poseSequence(), 1200);
    expect(pose.mode).toBe('pose');
    expect(pose.samples).toHaveLength(2);
    expect(validateTemplates([pose])[0].mode).toBe('pose');
  });
});
describe('streaming command state machine', () => {
  it('recognizes a whole action once and prevents repeated end-pose triggers', () => {
    const events: RecognitionEvent[] = [];
    const r = new GestureRecognizer([template()], (e) => events.push(e));
    r.setEnabled(true);
    const action = sequence(31, 1800);
    for (const f of action) r.push(f, f.t);
    const end = action.at(-1)!;
    for (let t = 1860; t < 5000; t += 60) r.push({ t, values: end.values }, t);
    expect(events).toHaveLength(1);
    expect(events[0].command).toBe('NEXT_SLIDE');
    expect(r.status.state).toBe('RELEASE');
  });
  it('rearms a subtle gesture after returning to its recorded starting pose', () => {
    const events: RecognitionEvent[] = [];
    const full = sequence(31, 1800);
    const start = full[0].values;
    const action = full.map((frame) => ({
      ...frame,
      values: frame.values.map((value, index) => start[index] + (value - start[index]) * 0.2),
    }));
    const gesture: GestureTemplate = { ...template(), samples: [action, action] };
    const r = new GestureRecognizer([gesture], (event) => events.push(event));
    r.setEnabled(true);
    for (const frame of action) r.push(frame, frame.t);
    const end = action.at(-1)!;
    for (let t = 1860; t <= 3000; t += 60) r.push({ t, values: end.values }, t);
    expect(events).toHaveLength(1);
    for (let t = 3060; t <= 3480; t += 60) r.push({ t, values: start }, t);
    expect(r.status.state).not.toBe('RELEASE');
    for (const frame of action) r.push({ ...frame, t: frame.t + 3540 }, frame.t + 3540);
    expect(events).toHaveLength(2);
  });
  it('does not act while paused or on missing poses', () => {
    const events: RecognitionEvent[] = [];
    const r = new GestureRecognizer([template()], (e) => events.push(e));
    for (const f of sequence()) r.push(f, f.t);
    expect(events).toHaveLength(0);
    r.setEnabled(true);
    r.push(null, 1);
    expect(r.status.state).toBe('NO_POSE');
  });
  it('rejects ambiguous profiles', () => {
    const events: RecognitionEvent[] = [];
    const g = template();
    const r = new GestureRecognizer([g, { ...g, id: 'other', command: 'PREVIOUS_SLIDE' }], (e) =>
      events.push(e),
    );
    r.setEnabled(true);
    for (const f of sequence(40, 2000)) r.push(f, f.t);
    expect(events).toHaveLength(0);
  });
  it('drops partial motion after a camera gap', () => {
    const events: RecognitionEvent[] = [];
    const r = new GestureRecognizer([template()], (e) => events.push(e));
    r.setEnabled(true);
    const action = sequence(30);
    for (const f of action.slice(0, 15)) r.push(f, f.t);
    r.push(null, 1000);
    for (const f of action.slice(15)) r.push({ ...f, t: f.t + 1000 }, f.t + 1000);
    expect(events).toHaveLength(0);
  });
  it('recognizes a static pose repeatedly only after the user leaves it', () => {
    const events: RecognitionEvent[] = [];
    const gesture = poseTemplate();
    const pose = poseSequence()[0].values;
    const neutral = sequence()[0].values;
    const r = new GestureRecognizer([gesture], (event) => events.push(event));

    r.setEnabled(true);

    for (const t of [0, 100, 200]) r.push({ t, values: pose }, t);
    expect(events).toHaveLength(1);

    for (const t of [400, 800, 1300, 1400]) r.push({ t, values: pose }, t);
    expect(events).toHaveLength(1);
    expect(r.status.state).toBe('RELEASE');

    for (const t of [1500, 1600]) r.push({ t, values: neutral }, t);
    for (const t of [1700, 1800, 1900]) r.push({ t, values: pose }, t);

    expect(events).toHaveLength(2);
  });
  it('can confirm a static pose from low-frequency background frames', () => {
    const events: RecognitionEvent[] = [];
    const pose = poseSequence()[0].values;
    const r = new GestureRecognizer([poseTemplate()], (event) => events.push(event));

    r.setEnabled(true);
    r.push({ t: 0, values: pose }, 0);
    r.push({ t: 1000, values: pose }, 1000);

    expect(events).toHaveLength(1);
  });
});
describe('profile input validation', () => {
  it('round trips a profile', () => {
    expect(parseProfile(JSON.stringify({ version: 1, gestures: [template()] }))[0].name).toBe(
      'Right reach',
    );
  });
  it('loads old profiles as legacy motion gestures', () => {
    const gesture = parseProfile(JSON.stringify({ version: 1, gestures: [template()] }))[0];
    expect(gesture.mode).toBe('motion');
  });
  it('rejects invalid coordinates and timestamps', () => {
    const g = template();
    g.samples[0][1].values[0] = Infinity;
    expect(() => validateTemplates([g])).toThrow();
    const t = template();
    t.samples[0][3].t = 0;
    expect(() => validateTemplates([t])).toThrow();
  });
  it('rejects duplicate IDs, unsupported commands and oversized profiles', () => {
    expect(() => validateTemplates([template(), template()])).toThrow();
    expect(() => validateTemplates([{ ...template(), command: 'DELETE_FILES' }])).toThrow();
    expect(() => parseProfile('a'.repeat(2_000_001))).toThrow();
  });
});
