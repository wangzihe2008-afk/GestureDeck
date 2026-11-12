import { useEffect, useRef } from 'react';
import { Camera, CameraOff, ScanLine, ShieldCheck } from 'lucide-react';
import type { PosePacket, RecognitionStatus } from '../core/types';
import { drawSkeleton } from '../vision/drawing';

const states: Record<string, string> = {
  PAUSED: 'Control paused',
  READY: 'Waiting for a pose',
  MATCHING: 'Confirming pose',
  COOLDOWN: 'Cooldown',
  RELEASE: 'Leave the pose and return to neutral',
  NO_POSE: 'Pose lost · Commands blocked',
};
export function CameraView({
  packet,
  active,
  loading,
  videoRef,
  onStart,
  onStop,
  status,
}: {
  packet: PosePacket | null;
  active: boolean;
  loading: boolean;
  videoRef: (node: HTMLVideoElement | null) => void;
  onStart: () => void;
  onStop: () => void;
  status: RecognitionStatus;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ready = active && Boolean(packet?.frame);
  const readiness = !active
    ? 'Camera off'
    : ready
      ? 'Ready to use'
      : packet
        ? 'Adjust camera'
        : 'Checking…';
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    try {
      drawSkeleton(target, active ? (packet?.landmarks ?? []) : []);
    } catch {
      // A preview drawing failure must never take down recording or navigation.
      target.getContext('2d')?.clearRect(0, 0, target.width, target.height);
    }
  }, [packet, active]);
  return (
    <aside className="camera-panel card">
      <div className="panel-heading">
        <span>
          <ScanLine size={17} /> Live pose
        </span>
        <span className={`pill ${active && packet?.frame ? 'green' : ''}`}>
          <i />
          {active ? (packet?.frame ? 'Tracking' : 'Searching') : 'Camera off'}
        </span>
      </div>
      <div
        className={`camera-frame ${active ? 'is-active' : ''}`}
        style={{
          aspectRatio:
            packet?.width && packet?.height ? `${packet.width} / ${packet.height}` : '4 / 3',
        }}
      >
        <video ref={videoRef} autoPlay muted playsInline aria-label="Mirrored camera preview" />
        <canvas
          ref={canvas}
          width={packet?.width || 640}
          height={packet?.height || 480}
          aria-hidden="true"
        />
        {!active && (
          <div className="camera-placeholder">
            <div className="camera-outline">
              <Camera size={30} />
            </div>
            <strong>{loading ? 'Starting camera and model…' : 'Turn a pose into control'}</strong>
            <p>
              Allow the camera, then keep your
              <br />
              shoulders, elbows and wrists in view.
            </p>
          </div>
        )}
        {active && (
          <>
            <span className="camera-live">
              <i /> LIVE
            </span>
            <span className="camera-caption">Mirrored · Processed locally</span>
          </>
        )}
      </div>
      <div className="camera-body">
        <div className="quality-row" role="status">
          <span>Pose readiness</span>
          <b>{readiness}</b>
        </div>
        <p className="helper">
          {ready
            ? 'Ready to capture and recognize poses. A perfect confidence score is not required.'
            : active
              ? (packet?.message ?? 'Looking for your pose…')
              : 'The camera starts only when you choose. No microphone access.'}
        </p>
        <button
          className={`button ${active ? 'secondary' : 'primary'} wide`}
          onClick={active ? onStop : onStart}
          disabled={loading}
        >
          {active ? <CameraOff size={17} /> : <Camera size={17} />}{' '}
          {loading ? 'Starting…' : active ? 'Stop camera' : 'Start camera'}
        </button>
        <div className="recognition-line">
          <span className={`status-dot ${status.state !== 'PAUSED' ? 'online' : ''}`} />
          {states[status.state]}
          {status.candidate && (
            <small>
              {status.candidate} · {status.score}
            </small>
          )}
        </div>
      </div>
      <div className="privacy-note">
        <ShieldCheck size={16} />
        <span>Pose data only. No photos or video saved.</span>
      </div>
    </aside>
  );
}
