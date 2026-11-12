import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Download,
  Link2,
  Pause,
  Play,
  RefreshCw,
  Square,
  Webcam,
} from 'lucide-react';
import { ConnectorClient, type ConnectorStatus, type TargetTab } from '../bridge/ConnectorClient';
import type { GestureTemplate, Platform } from '../core/types';
import { FrameRate } from '../vision/FrameRate';

const REQUIRED_CONNECTOR_VERSION = '1.8.0';

const recognitionLabels: Record<string, string> = {
  READY: 'Ready for your pose',
  MATCHING: 'Hold your pose',
  COOLDOWN: 'Brief cooldown - lower your arms now',
  RELEASE: 'Lower your arms before the next pose',
  NO_POSE: 'Keep both arms in view',
  CHECKING_CAMERA: 'Checking camera frames',
  PAUSED: 'Control paused',
};

function isSlideshow(tab: TargetTab, platform: Platform) {
  try {
    const path = new URL(tab.url).pathname;
    return platform === 'google'
      ? /\/(present|preview|embed)(\/|$)/.test(path)
      : /\/(view|present)(\/|$)/.test(path);
  } catch {
    return false;
  }
}

export function ExternalControl({
  gestures,
  onNotice,
}: {
  gestures: GestureTemplate[];
  onNotice: (text: string) => void;
}) {
  const client = useRef<ConnectorClient | null>(null);
  const previewImage = useRef<HTMLImageElement | null>(null);
  const previewRate = useRef(new FrameRate());
  const [connected, setConnected] = useState(false);
  const [connectorVersion, setConnectorVersion] = useState('');
  const [platform, setPlatform] = useState<Platform>('google');
  const [tabs, setTabs] = useState<TargetTab[]>([]);
  const [tabId, setTabId] = useState('');
  const [status, setStatus] = useState<ConnectorStatus>({ running: false, paused: false });
  const [previewReady, setPreviewReady] = useState(false);
  const [previewFps, setPreviewFps] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const compatible = connected && connectorVersion === REQUIRED_CONNECTOR_VERSION;
  const poseReady = Boolean(
    status.running &&
      !status.paused &&
      status.poseReady &&
      Date.now() - (status.poseUpdatedAt ?? 0) < 5000,
  );

  useEffect(() => {
    const c = new ConnectorClient();
    client.current = c;
    const clearPreview = () => {
      previewRate.current.reset();
      setPreviewReady(false);
      setPreviewFps(0);
      previewImage.current?.removeAttribute('src');
    };
    const receive = (next: ConnectorStatus) => {
      setStatus(next);
      if (!next.running) clearPreview();
    };
    c.onStatus = receive;
    c.onPreview = (preview) => {
      const image = previewImage.current;
      if (!image) return;
      image.src = preview;
    };
    const ping = () =>
      c
        .ping()
        .then((r) => {
          setConnected(true);
          setConnectorVersion(r.version);
          receive(r.status);
          if (r.status.running && r.status.platform) setPlatform(r.status.platform);
        })
        .catch(() => {
          setConnected(false);
          setConnectorVersion('');
        });
    void ping();
    const timer = setInterval(() => void ping(), 2500);
    const previewTimer = setInterval(
      () => setPreviewFps(previewRate.current.get(performance.now())),
      500,
    );
    const syncPreview = () =>
      void c.previewVisibility(document.visibilityState === 'visible').catch(() => {});
    document.addEventListener('visibilitychange', syncPreview);
    syncPreview();
    return () => {
      clearInterval(timer);
      clearInterval(previewTimer);
      document.removeEventListener('visibilitychange', syncPreview);
      void c.previewVisibility(false).catch(() => {});
      c.dispose();
      client.current = null;
    };
  }, []);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const targets = await client.current!.tabs(platform);
    setTabs(targets);
    const preferred = targets.find((t) => isSlideshow(t, platform)) ?? targets[0];
    setTabId(preferred?.id.toString() ?? '');
    if (!targets.length)
      setError(
        `No ${platform === 'google' ? 'Google Slides' : 'Canva'} tabs found. Open a presentation in the same Chrome profile first.`,
      );
  }
  useEffect(() => {
    setTabs([]);
    setTabId('');
    if (compatible && !status.running) void act(refresh);
  }, [platform, compatible]);

  const chosen = tabs.find((tab) => tab.id.toString() === tabId);
  const slideshowSelected =
    status.targetView === 'Slideshow' || Boolean(chosen && isSlideshow(chosen, platform));
  const canTest = compatible && !busy && slideshowSelected && (status.running || Boolean(tabId));
  async function testCommand(command: 'PREVIOUS_SLIDE' | 'NEXT_SLIDE') {
    if (!status.running) await client.current!.bind(platform, +tabId);
    await client.current!.command(command);
    onNotice('Navigation command sent. Check your slideshow to confirm the change.');
  }
  const readinessTitle = status.paused
    ? 'Background control is paused'
    : poseReady
      ? status.targetView === 'Slideshow'
        ? 'Live pose control'
        : 'Ready for Present'
      : 'Adjust the camera before Present';
  const readinessMessage = status.paused
    ? 'Resume control, then confirm that your upper body is visible.'
    : status.poseMessage || 'Waiting for the first camera frame…';

  return (
    <div className="external-content">
      <div className="card external-hero">
        <div className="connector-art">
          <Link2 size={34} />
          <span>↗</span>
        </div>
        <div>
          <span className="eyebrow">BEYOND THE PDF</span>
          <h2>Your poses. More ways to present.</h2>
          <p>
            Choose Google Slides or Canva. The connector keeps recognition running while your slides
            are in front.
          </p>
        </div>
        <span className={`pill ${compatible ? 'green' : ''}`}>
          <i />
          {compatible
            ? 'Connector online'
            : connected
              ? 'Connector update required'
              : 'Connector offline'}
        </span>
      </div>
      <div className="external-grid">
        <div className="card external-form">
          <div className="section-title">
            <h3>Set up external slides</h3>
            <span className="step-label">Local Chrome connector</span>
          </div>
          <label>1. Choose a platform</label>
          <div className="platform-picker">
            <button
              className={platform === 'google' ? 'selected' : ''}
              disabled={status.running}
              onClick={() => setPlatform('google')}
            >
              <span className="platform-mark google">▤</span>
              <b>Google Slides</b>
              {platform === 'google' && <Check size={17} />}
            </button>
            <button
              className={platform === 'canva' ? 'selected' : ''}
              disabled={status.running}
              onClick={() => setPlatform('canva')}
            >
              <span className="platform-mark canva">C</span>
              <b>Canva</b>
              {platform === 'canva' && <Check size={17} />}
            </button>
          </div>
          <label>2. Select your presentation tab</label>
          <div className="target-row">
            <select
              aria-label="Presentation tab"
              value={tabId}
              disabled={status.running || !compatible}
              onChange={(e) => setTabId(e.target.value)}
            >
              <option value="">Open your presentation, then refresh</option>
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {isSlideshow(t, platform) ? 'Slideshow' : 'Editor'}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              title="Refresh tabs"
              aria-label="Refresh tabs"
              disabled={!compatible || busy || status.running}
              onClick={() => void act(refresh)}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          <label>3. First time? Allow camera access</label>
          <button
            className="button secondary wide"
            disabled={!compatible || busy || status.running}
            onClick={() =>
              void act(async () => {
                await client.current!.cameraPermission();
                onNotice(
                  'The connector permission page is open. Click Allow camera, then return here.',
                );
              })
            }
          >
            <Webcam size={18} />
            Open camera permissions
          </button>
          <p className="helper">
            Start the camera check before Present. Do not enter fullscreen until this page says
            Ready for Present; the connector will then follow the Slideshow tab automatically.
          </p>
          {connected && !compatible && (
            <div className="inline-error" role="alert">
              Connector {connectorVersion || 'unknown'} is still loaded, but this website requires{' '}
              {REQUIRED_CONNECTOR_VERSION}. Open <code>chrome://extensions</code>, reload
              GestureDeck Connector from the current <code>connector/dist</code> folder, then
              refresh this page.
            </div>
          )}
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          {status.error && (
            <div className="inline-error" role="alert">
              {status.error}
            </div>
          )}
          <div className="form-actions">
            {!status.running ? (
              <button
                className="button primary wide"
                disabled={!compatible || !tabId || !gestures.some((g) => g.enabled) || busy}
                onClick={() =>
                  void act(async () => {
                    await client.current!.start(platform, +tabId, gestures);
                    setStatus((s) => ({
                      ...s,
                      running: true,
                      paused: false,
                      poseReady: false,
                      poseMessage: 'Waiting for the first camera frame…',
                    }));
                    onNotice(
                      'Camera check started. Wait for Ready for Present before opening the slideshow.',
                    );
                  })
                }
              >
                <Camera size={17} />
                {busy ? 'Starting camera…' : 'Start camera check'}
              </button>
            ) : (
              <>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await client.current!.pause(!status.paused);
                      setStatus((s) => ({ ...s, paused: !s.paused }));
                    })
                  }
                >
                  {status.paused ? <Play size={17} /> : <Pause size={17} />}{' '}
                  {status.paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await client.current!.stop();
                      setStatus({ running: false, paused: false });
                    })
                  }
                >
                  <Square size={16} />
                  Stop & release camera
                </button>
              </>
            )}
          </div>

          {status.running && (
            <div className={`external-camera-check ${poseReady ? 'ready' : ''}`} role="status">
              <div className="external-camera-preview">
                <img
                  ref={previewImage}
                  className={previewReady ? 'is-ready' : ''}
                  alt="Background camera preview"
                  onLoad={() => {
                    previewRate.current.add(performance.now());
                    setPreviewReady(true);
                  }}
                />
                {!previewReady && (
                  <div>
                    <Camera size={26} />
                    <span>Waiting for preview…</span>
                  </div>
                )}
                <span className="camera-preview-badge">Background camera</span>
              </div>
              <div className="external-camera-copy">
                <span className="eyebrow">LIVE CAMERA CHECK</span>
                <h4>{readinessTitle}</h4>
                <p>{readinessMessage}</p>
                <small>
                  {status.cameraLabel ?? 'Camera'}
                  {status.cameraWidth && status.cameraHeight
                    ? ` · ${status.cameraWidth} × ${status.cameraHeight}`
                    : ''}
                </small>
                <small>
                  Camera {status.captureFps ?? 0} FPS · Recognition {status.recognitionFps ?? 0} FPS
                  · Preview {previewFps} FPS
                </small>
                {poseReady && (
                  <b>
                    {status.targetView === 'Slideshow'
                      ? 'Hold a saved pose, lower your arms, then repeat. Stay in your slideshow.'
                      : 'Now click Present. You do not need to return to GestureDeck.'}
                  </b>
                )}
              </div>
            </div>
          )}

          <div className={`connector-live ${poseReady ? 'ready' : ''}`}>
            <span className={`status-dot ${poseReady ? 'online' : ''}`} />
            {!status.running
              ? 'External control has not started'
              : status.paused
                ? 'Paused'
                : poseReady
                  ? `Ready for Present · ${status.targetTitle ?? ''}`
                  : 'Camera check in progress'}
            {status.recognition && (
              <small>
                {recognitionLabels[status.recognition] ?? status.recognition}
                {status.score ? ` · match ${status.score}` : ''}
                {status.targetView ? ` · ${status.targetView}` : ''}
              </small>
            )}
            {status.running && (
              <small>
                {status.recognizedCount ?? 0} poses detected · {status.sentCount ?? 0} slide
                commands sent
              </small>
            )}
          </div>
          <div className="manual-test">
            <span>
              {slideshowSelected
                ? 'Optional navigation test'
                : 'Navigation test unlocks after Slideshow is detected'}
            </span>
            <button
              className="button secondary"
              disabled={!canTest}
              onClick={() => void act(() => testCommand('PREVIOUS_SLIDE'))}
            >
              <ArrowLeft size={15} />
              Previous slide
            </button>
            <button
              className="button secondary"
              disabled={!canTest}
              onClick={() => void act(() => testCommand('NEXT_SLIDE'))}
            >
              Next slide
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
        <div className="card install-card">
          <span className="eyebrow">FIRST-TIME SETUP</span>
          <h3>Install the connector</h3>
          <ol>
            <li>
              In the VS Code terminal, run <code>npm run build:connector</code>.
            </li>
            <li>
              In Chrome, open <code>chrome://extensions</code>, and enable Developer mode.
            </li>
            <li>
              Remove older GestureDeck Connector copies, then load <code>connector/dist</code>.
            </li>
            <li>Refresh this website and your presentation, then allow camera access.</li>
          </ol>
          <a className="button secondary wide" href="/connector.zip" download>
            <Download size={16} />
            Download connector
          </a>
          <div className="note-small">
            Run the local website at <code>http://localhost:5173</code>. Start the camera check on
            the Editor tab before opening Present. Wait for <b>Ready for Present</b>.
          </div>
          <div className="note-small">
            Emergency pause: <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd>, or click the
            extension icon to stop. Camera preview frames stay on this computer and are not saved.
          </div>
        </div>
      </div>
    </div>
  );
}
