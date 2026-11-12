import { COMMANDS, type GestureTemplate } from './types';
import { FEATURE_SIZE } from './normalize';

const KEY = 'gesturedeck.gestures.v1';
export function validateTemplates(value: unknown): GestureTemplate[] {
  if (!Array.isArray(value) || value.length > 30)
    throw new Error('A profile can contain up to 30 poses.');
  const ids = new Set<string>();
  for (const g of value) {
    if (
      !g ||
      typeof g.id !== 'string' ||
      g.id.length > 100 ||
      ids.has(g.id) ||
      typeof g.name !== 'string' ||
      !g.name.trim() ||
      g.name.length > 40 ||
      !COMMANDS.includes(g.command) ||
      (g.mode !== undefined && g.mode !== 'pose' && g.mode !== 'motion') ||
      typeof g.enabled !== 'boolean'
    )
      throw new Error('Invalid gesture profile format.');
    ids.add(g.id);
    if (
      !Number.isFinite(g.threshold) ||
      g.threshold < 0.1 ||
      g.threshold > 0.5 ||
      !Number.isFinite(g.cooldownMs) ||
      g.cooldownMs < 600 ||
      g.cooldownMs > 5000
    )
      throw new Error('Threshold or cooldown is outside the allowed range.');
    if (typeof g.createdAt !== 'string' || !Array.isArray(g.samples) || g.samples.length !== 2)
      throw new Error(
        'The saved pose data is incomplete. Capture this pose again or import a valid backup.',
      );

    const mode = g.mode ?? 'motion';

    for (const sample of g.samples) {
      const minimumFrames = mode === 'pose' ? 4 : 12;
      const maximumFrames = mode === 'pose' ? 30 : 80;

      if (!Array.isArray(sample) || sample.length < minimumFrames || sample.length > maximumFrames)
        throw new Error('Gesture frame count is outside the allowed range.');

      let last = -1;
      for (const f of sample) {
        if (
          !Number.isFinite(f.t) ||
          f.t <= last ||
          f.t < 0 ||
          f.t > (mode === 'pose' ? 1100 : 2200) ||
          !Array.isArray(f.values) ||
          f.values.length !== FEATURE_SIZE ||
          f.values.some(
            (v: unknown) => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 20,
          )
        )
          throw new Error('Invalid gesture pose data.');
        last = f.t;
      }

      if (sample[0].t !== 0 || last < (mode === 'pose' ? 250 : 650))
        throw new Error('Invalid gesture timestamps.');
    }
  }

  return (value as GestureTemplate[]).map((gesture) => ({
    ...gesture,
    mode: gesture.mode ?? 'motion',
  }));
}
export function loadGestures(): GestureTemplate[] {
  const raw = localStorage.getItem(KEY);
  return raw ? validateTemplates(JSON.parse(raw)) : [];
}
export function saveGestures(gestures: GestureTemplate[]) {
  localStorage.setItem(KEY, JSON.stringify(validateTemplates(gestures)));
}
export function parseProfile(text: string) {
  if (text.length > 2_000_000) throw new Error('Profile file is too large. Maximum size is 2 MB.');
  const object = JSON.parse(text);
  if (object.version !== 1) throw new Error('Unsupported profile version.');
  return validateTemplates(object.gestures);
}
