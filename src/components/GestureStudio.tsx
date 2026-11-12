import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Info, RotateCcw, Save, ScanLine } from 'lucide-react';
import {
  COMMANDS,
  COMMAND_LABELS,
  type Command,
  type GestureTemplate,
  type PosePacket,
  type PoseSequence,
} from '../core/types';
import { findConflict, makePoseGesture, validatePoseCapture } from '../core/trainer';
import { relativeSequence } from '../core/normalize';

const CAPTURE_DURATION_MS = 650;

export function GestureStudio({
  packet,
  cameraActive,
  gestures,
  onSave,
  onNotice,
}: {
  packet: PosePacket | null;
  cameraActive: boolean;
  gestures: GestureTemplate[];
  onSave: (gesture: GestureTemplate) => void;
  onNotice: (text: string) => void;
}) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState<Command>('NEXT_SLIDE');
  const [cooldown, setCooldown] = useState(1200);
  const [sample, setSample] = useState<PoseSequence | null>(null);
  const [phase, setPhase] = useState<'idle' | 'countdown' | 'capturing'>('idle');
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState('');

  const recording = useRef<{ start: number; frames: PoseSequence } | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const packetRef = useRef(packet);

  packetRef.current = packet;

  useEffect(() => () => clearInterval(interval.current), []);

  useEffect(() => {
    if (phase === 'idle' || cameraActive) return;

    clearInterval(interval.current);
    recording.current = null;
    setPhase('idle');
    setError('The camera stopped. This pose was not captured.');
  }, [cameraActive, phase]);

  useEffect(() => {
    const current = recording.current;

    if (
      current &&
      phase === 'capturing' &&
      packet?.frame &&
      packet.time >= current.start &&
      packet.time <= current.start + CAPTURE_DURATION_MS &&
      current.frames[current.frames.length - 1]?.t !== packet.time
    )
      current.frames.push(packet.frame);
  }, [packet, phase]);

  function capture() {
    clearInterval(interval.current);
    setError('');
    setPhase('countdown');
    setRemaining(3);

    const countdownStart = performance.now();

    interval.current = setInterval(() => {
      const elapsed = performance.now() - countdownStart;

      if (elapsed < 3000) {
        setRemaining(Math.ceil((3000 - elapsed) / 1000));
        return;
      }

      clearInterval(interval.current);

      if (!packetRef.current?.frame || performance.now() - packetRef.current.time > 400) {
        setPhase('idle');
        setError(
          'Your pose was not clear when the countdown ended. Keep both arms visible and try again.',
        );
        return;
      }

      const start = performance.now();
      recording.current = { start, frames: [] };
      setPhase('capturing');
      setRemaining(CAPTURE_DURATION_MS / 1000);

      interval.current = setInterval(() => {
        const left = (CAPTURE_DURATION_MS - (performance.now() - start)) / 1000;
        setRemaining(Math.max(0, left));

        if (left > 0) return;

        clearInterval(interval.current);

        const frames = relativeSequence(recording.current?.frames ?? []);
        recording.current = null;
        setPhase('idle');

        const validation = validatePoseCapture(frames);

        if (validation) {
          setError(validation);
          return;
        }

        setSample(frames);
      }, 40);
    }, 50);
  }

  function cancel() {
    clearInterval(interval.current);
    recording.current = null;
    setPhase('idle');
    setRemaining(0);
  }

  function save() {
    try {
      if (!name.trim()) throw new Error('Enter a name for your pose.');
      if (!sample) throw new Error('Capture your pose before saving.');
      if (gestures.length >= 30)
        throw new Error('You can save up to 30 poses. Remove an unused pose first.');
      if (gestures.some((gesture) => gesture.name.toLowerCase() === name.trim().toLowerCase()))
        throw new Error('That name already exists. Choose a different name.');

      const template = makePoseGesture(name, command, sample, cooldown);
      const conflict = findConflict(template, gestures);

      if (conflict)
        throw new Error(
          `This pose is too similar to "${conflict.gesture.name}" (match index ${conflict.score}). Choose a more distinct pose.`,
        );

      onSave(template);
      setSample(null);
      setName('');
      setError('');
      onNotice('Pose saved. Try it in Test Lab before opening your presentation.');
    } catch (exception) {
      setError((exception as Error).message);
    }
  }

  return (
    <div className="studio-content">
      <div className="card studio-form">
        <div className="section-title">
          <div>
            <span className="eyebrow">POSE STUDIO</span>
            <h2>Capture one pose</h2>
          </div>
          <span className="step-label">{sample ? '1 / 1 captured' : 'Ready to capture'}</span>
        </div>

        <p className="muted">
          Choose one clear body pose and hold it still for 0.7 seconds. Capture it once, assign a
          command, then use the same pose to control your slides.
        </p>

        <div className="form-grid">
          <label>
            Pose name
            <input
              maxLength={40}
              placeholder="e.g. Right arm raised"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={phase !== 'idle'}
            />
          </label>

          <label>
            Command
            <select
              value={command}
              onChange={(event) => setCommand(event.target.value as Command)}
              disabled={phase !== 'idle'}
            >
              {COMMANDS.map((item) => (
                <option key={item} value={item}>
                  {COMMAND_LABELS[item]}
                </option>
              ))}
            </select>
          </label>

          <label>
            Command cooldown
            <select
              value={cooldown}
              disabled={phase !== 'idle'}
              onChange={(event) => setCooldown(+event.target.value)}
            >
              <option value={1200}>1.2 s (recommended)</option>
              <option value={1800}>1.8 s</option>
              <option value={2500}>2.5 s</option>
            </select>
          </label>
        </div>

        <div className="takes">
          <div className={`take ${sample ? 'done' : 'current'}`}>
            <span className="take-number">{sample ? <Check size={18} /> : '01'}</span>
            <div>
              <strong>Single pose</strong>
              <small>
                {sample
                  ? `${sample.length} stable frames captured`
                  : 'Move into position during the countdown, then hold still'}
              </small>
            </div>
            {sample && <Check size={16} />}
          </div>
        </div>

        {phase !== 'idle' && (
          <div
            className={`record-banner ${phase === 'capturing' ? 'recording' : ''}`}
            role="status"
          >
            <Circle size={14} fill="currentColor" />
            {phase === 'countdown'
              ? `Get into your pose: capturing in ${remaining}s`
              : `Hold still: ${remaining.toFixed(1)}s left`}
            <button className="text-button" onClick={cancel}>
              Cancel
            </button>
          </div>
        )}

        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}

        <div className="form-actions">
          {!sample ? (
            <button
              className="button primary"
              onClick={capture}
              disabled={!cameraActive || phase !== 'idle' || !name.trim()}
            >
              <ScanLine size={18} />
              Capture pose
              <span className="key-hint">0.7s</span>
            </button>
          ) : (
            <button className="button primary" onClick={save}>
              <Save size={17} />
              Save pose
            </button>
          )}

          {sample && phase === 'idle' && (
            <button
              className="button secondary"
              onClick={() => {
                setSample(null);
                setError('');
              }}
            >
              <RotateCcw size={16} />
              Capture again
            </button>
          )}
        </div>

        {!cameraActive && (
          <p className="helper">Start the camera, enter a pose name, then capture your pose.</p>
        )}
      </div>

      <div className="tip-card">
        <Info size={19} />
        <div>
          <strong>Use a pose you will not make while speaking normally.</strong>
          <p>
            Keep both arms in view. After a slide changes, leave the pose and return to a neutral
            stance before using it again. Choose clearly different poses for Next and Previous.
          </p>
        </div>
      </div>
    </div>
  );
}
