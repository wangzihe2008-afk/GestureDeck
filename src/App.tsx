import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Command as CommandIcon,
  FlaskConical,
  Hand,
  Layers,
  LayoutDashboard,
  Link2,
  Menu,
  Moon,
  MonitorPlay,
  MousePointer2,
  Pause,
  Play,
  Plus,
  ScanLine,
  Search,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { PoseCamera } from './vision/PoseCamera';
import { GestureRecognizer } from './core/recognizer';
import { loadGestures, saveGestures } from './core/storage';
import {
  COMMAND_LABELS,
  type GestureTemplate,
  type PosePacket,
  type RecognitionEvent,
  type RecognitionStatus,
} from './core/types';
import { CameraView } from './components/CameraView';
import { GestureStudio } from './components/GestureStudio';
import { GestureLibrary } from './components/GestureLibrary';
import { PdfStage } from './components/PdfStage';
import { ExternalControl } from './components/ExternalControl';

type Page = 'home' | 'studio' | 'pdf' | 'external' | 'lab' | 'guide';
type Theme = 'dark' | 'light';

function loadTheme(): Theme {
  try {
    return localStorage.getItem('gesturedeck-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

const pageInfo: Record<Page, [string, string]> = {
  home: [
    'Your next slide. Your move.',
    'Teach GestureDeck one clear pose, then present without holding a remote.',
  ],
  studio: [
    'Pose Studio',
    'Capture one still pose, assign a command, and use it across your presentations.',
  ],
  pdf: [
    'PDF Presentation',
    'Upload a PDF, keep it local, and move through your slides with your own poses.',
  ],
  external: [
    'Connect external slides',
    'Control Google Slides or Canva through the Chrome connector.',
  ],
  lab: ['Test Lab', 'Try your poses and catch accidental triggers before your presentation.'],
  guide: [
    'A few things before you begin.',
    'One set of poses. Two presentation modes. Start simple and test for reliability.',
  ],
};

const navItems: [Page, typeof LayoutDashboard, string, string][] = [
  ['home', LayoutDashboard, 'Overview', '⌘1'],
  ['studio', Hand, 'Pose Studio', '⌘2'],
  ['pdf', MonitorPlay, 'PDF Presentation', '⌘3'],
  ['external', Link2, 'External Slides', '⌘4'],
  ['lab', FlaskConical, 'Test Lab', '⌘5'],
];

const emptyStatus: RecognitionStatus = { state: 'PAUSED', candidate: '', score: 0, progress: 0 };

export function App() {
  const [page, setPage] = useState<Page>('home');
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [mobileNav, setMobileNav] = useState(false);
  const [gestures, setGestures] = useState<GestureTemplate[]>([]);
  const [notice, setNotice] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [packet, setPacket] = useState<PosePacket | null>(null);
  const [status, setStatus] = useState(emptyStatus);
  const [live, setLive] = useState(false);
  const [lastEvent, setLastEvent] = useState<RecognitionEvent | null>(null);
  const [events, setEvents] = useState<RecognitionEvent[]>([]);
  const [beep, setBeep] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);

  const camera = useRef<PoseCamera | null>(null);
  const cameraVideo = useRef<HTMLVideoElement | null>(null);
  const recognizer = useRef<GestureRecognizer | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const beepRef = useRef(beep);
  beepRef.current = beep;
  const audio = useRef<AudioContext | null>(null);
  const onCommandRef = useRef<(e: RecognitionEvent) => void>(() => {});

  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    try {
      localStorage.setItem('gesturedeck-theme', theme);
    } catch {}
  }, [theme]);

  onCommandRef.current = (event) => {
    setLastEvent(event);
    setEvents((log) => [event, ...log].slice(0, 100));
    if (beepRef.current && audio.current) {
      const oscillator = audio.current.createOscillator();
      const gain = audio.current.createGain();
      oscillator.connect(gain);
      gain.connect(audio.current.destination);
      oscillator.frequency.value = 620;
      gain.gain.setValueAtTime(0.06, audio.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.current.currentTime + 0.1);
      oscillator.start();
      oscillator.stop(audio.current.currentTime + 0.1);
    }
    if (event.command === 'TOGGLE_CONTROL') {
      recognizer.current?.setEnabled(false);
      setLive(false);
      setNotice('Control paused. Click Enable control to resume, or use the keyboard shortcut.');
    }
  };
  useEffect(() => {
    try {
      setGestures(loadGestures());
    } catch (e) {
      setNotice(
        `Could not load pose settings: ${(e as Error).message}. Your original data has not been overwritten.`,
      );
    }
    recognizer.current = new GestureRecognizer([], (e) => onCommandRef.current(e));
    return () => {
      camera.current?.stop();
      void audio.current?.close();
    };
  }, []);
  useEffect(() => {
    recognizer.current?.setTemplates(gestures);
    setLive(false);
    recognizer.current?.setEnabled(false);
    setStatus(emptyStatus);
  }, [gestures]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 8500);
    return () => clearTimeout(timer);
  }, [notice]);

  const stopCamera = useCallback(() => {
    camera.current?.stop();
    setCameraActive(false);
    setCameraLoading(false);
    setPacket(null);
    recognizer.current?.setEnabled(false);
    setLive(false);
    setStatus(emptyStatus);
  }, []);
  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    if (node === cameraVideo.current) return;
    camera.current?.stop();
    cameraVideo.current = node;
    if (node)
      camera.current = new PoseCamera(
        node,
        (p) => {
          setPacket(p);
          setStatus({ ...(recognizer.current?.push(p.frame, p.time) ?? emptyStatus) });
        },
        (message) => {
          setNotice(message);
          setCameraActive(false);
          setLive(false);
          recognizer.current?.setEnabled(false);
        },
      );
    else camera.current = null;
  }, []);
  async function startCamera() {
    setCameraLoading(true);
    try {
      await camera.current?.start(new URL('/', location.href).href);
      setCameraActive(Boolean(cameraVideo.current?.srcObject));
    } catch (e) {
      setNotice((e as Error).message);
      setCameraActive(false);
    } finally {
      setCameraLoading(false);
    }
  }
  function navigate(next: Page) {
    recognizer.current?.setEnabled(false);
    setLive(false);
    setStatus(emptyStatus);
    if (['home', 'external', 'guide'].includes(next)) stopCamera();
    setPage(next);
    setMobileNav(false);
    setPaletteOpen(false);
    setPaletteQuery('');
    setPaletteIndex(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function changeGestures(next: GestureTemplate[]) {
    try {
      saveGestures(next);
      setGestures(next);
    } catch (e) {
      setNotice(
        `Not saved: ${(e as Error).message}. Export a backup and check whether browser storage is enabled.`,
      );
    }
  }
  function toggleLive() {
    const enabled = !recognizer.current?.isEnabled();
    if (enabled && (!cameraActive || !gestures.some((g) => g.enabled))) {
      setNotice('Start the camera and save at least one enabled pose first.');
      return;
    }
    if (enabled && beep) {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    }
    recognizer.current?.setEnabled(enabled);
    setLive(enabled);
    setStatus({ ...(recognizer.current?.status ?? emptyStatus) });
  }

  const filteredNavigation = useMemo(
    () =>
      navItems.filter(([, , label]) =>
        label.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
      ),
    [paletteQuery],
  );

  useEffect(() => {
    // PDF/studio should stop rather than queue stale gestures after being hidden.
    function hidden() {
      if (document.hidden && pageRef.current !== 'external') {
        recognizer.current?.setEnabled(false);
        setLive(false);
        setStatus(emptyStatus);
      }
    }
    function safety(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyK') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        setPaletteQuery('');
        setPaletteIndex(0);
        return;
      }

      if (paletteOpen) {
        if (e.code === 'Escape') {
          e.preventDefault();
          setPaletteOpen(false);
          return;
        }

        if (e.code === 'ArrowDown') {
          e.preventDefault();
          setPaletteIndex((index) =>
            filteredNavigation.length ? (index + 1) % filteredNavigation.length : 0,
          );
          return;
        }

        if (e.code === 'ArrowUp') {
          e.preventDefault();
          setPaletteIndex((index) =>
            filteredNavigation.length
              ? (index - 1 + filteredNavigation.length) % filteredNavigation.length
              : 0,
          );
          return;
        }

        if (e.code === 'Enter' && filteredNavigation[paletteIndex]) {
          e.preventDefault();
          navigate(filteredNavigation[paletteIndex][0]);
          return;
        }
      }

      if (!editing && (e.metaKey || e.ctrlKey) && /^Digit[1-5]$/.test(e.code)) {
        e.preventDefault();
        const item = navItems[Number(e.code.slice(-1)) - 1];
        if (item) navigate(item[0]);
        return;
      }

      if (e.altKey && e.shiftKey && e.code === 'KeyG') {
        e.preventDefault();
        recognizer.current?.setEnabled(false);
        setLive(false);
        setStatus(emptyStatus);
      }
    }
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('keydown', safety);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('keydown', safety);
    };
  }, [filteredNavigation, paletteIndex, paletteOpen]);

  const activeCount = gestures.filter((g) => g.enabled).length;
  const hasCamera = ['studio', 'pdf', 'lab'].includes(page);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('home');
          }}
        >
          <img src="/logo.svg" alt="" />
          <span>
            GestureDeck<small>MOVE. PRESENT. CONNECT.</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">G</span>
          <div>
            Personal workspace<small>Local workspace</small>
          </div>
          <span className="local-chip">Local</span>
        </div>
        <div className="nav-heading">WORKSPACE</div>
        <nav>
          {navItems.map(([id, Icon, label, shortcut]) => (
            <button className={page === id ? 'active' : ''} onClick={() => navigate(id)} key={id}>
              <Icon size={19} />
              <span>{label}</span>
              {id === 'studio' && gestures.length > 0 ? (
                <small>{gestures.length}</small>
              ) : (
                <kbd className="nav-shortcut">{shortcut}</kbd>
              )}
              {page === id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <div>
              <CommandIcon size={17} />
              <b>Present with more freedom.</b>
            </div>
            <p>
              No remote to hold.
              <br />
              Just a pose to move on.
            </p>
            <button onClick={() => navigate('guide')}>
              Read the guide <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className={page === 'guide' ? 'help active' : 'help'}
            onClick={() => navigate('guide')}
          >
            <CircleHelp size={18} />
            Help & guide
          </button>
          <div className="sidebar-version">
            <span>
              <i /> On-device processing
            </span>
            <small>v1.8</small>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button className="nav-scrim" aria-label="Close menu" onClick={() => setMobileNav(false)} />
      )}
      <main className="main">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <b>
              {page === 'home'
                ? 'Overview'
                : page === 'studio'
                  ? 'Pose Studio'
                  : page === 'pdf'
                    ? 'PDF Presentation'
                    : page === 'external'
                      ? 'External Control'
                      : page === 'lab'
                        ? 'Test Lab'
                        : 'Guide'}
            </b>
          </div>
          <div className="topbar-actions">
            <button
              className="theme-toggle"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
            <button
              className="command-launcher"
              onClick={() => {
                setPaletteOpen(true);
                setPaletteQuery('');
                setPaletteIndex(0);
              }}
            >
              <Search size={15} />
              <span>Jump to...</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-privacy">
              <ShieldCheck size={15} />
              Your poses stay on your device.
            </span>
          </div>
        </header>
        <div className="main-content page-view" key={page}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === 'home'
                  ? 'YOUR PRESENTATION, IN MOTION'
                  : 'GESTUREDECK / ' + page.toUpperCase()}
              </div>
              <h1>{pageInfo[page][0]}</h1>
              <p>{pageInfo[page][1]}</p>
            </div>
            {page === 'home' && (
              <button className="button primary" onClick={() => navigate('studio')}>
                <Plus size={18} />
                Create pose
              </button>
            )}
          </div>
          {page === 'home' && (
            <>
              <div className="home-hero">
                <div className="hero-copy">
                  <div className="hero-tag">
                    <span /> Built around your pose
                  </div>
                  <h2>
                    Put the clicker down.
                    <br />
                    <span>Let your poses lead.</span>
                  </h2>
                  <p>
                    Capture a pose. Track it with your camera.
                    <br className="desktop-break" />
                    Keep the pace of your presentation in your hands.
                  </p>
                  <div className="hero-actions">
                    <button className="button light" onClick={() => navigate('pdf')}>
                      Present a PDF <ArrowRight size={17} />
                    </button>
                    <button className="hero-link" onClick={() => navigate('external')}>
                      Connect your slides <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <span className="hero-foot">
                    <ShieldCheck size={14} /> No account · No video uploads · No extra hardware
                  </span>
                </div>
                <div className="hero-art">
                  <div
                    className="command-window command-window-trigger"
                    role="button"
                    tabIndex={0}
                    onClick={() => setPaletteOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setPaletteOpen(true);
                      }
                    }}
                  >
                    <div className="command-search">
                      <CommandIcon size={16} />
                      <span>Choose an action...</span>
                      <kbd>⌘ K</kbd>
                    </div>
                    <div className="command-group-label">Quick actions</div>
                    <div className="command-option active">
                      <span className="command-option-icon">
                        <MonitorPlay size={17} />
                      </span>
                      <div>
                        <strong>Present a PDF</strong>
                        <small>Open local slides</small>
                      </div>
                      <kbd>↵</kbd>
                    </div>
                    <div className="command-option">
                      <span className="command-option-icon">
                        <Link2 size={17} />
                      </span>
                      <div>
                        <strong>Connect external slides</strong>
                        <small>Canva or Google Slides</small>
                      </div>
                      <kbd>⌘ E</kbd>
                    </div>
                    <div className="command-option">
                      <span className="command-option-icon">
                        <Hand size={17} />
                      </span>
                      <div>
                        <strong>Create a pose</strong>
                        <small>Capture one clear gesture</small>
                      </div>
                      <kbd>⌘ N</kbd>
                    </div>
                    <div className="command-footer">
                      <span>
                        <i /> Camera ready
                      </span>
                      <span>GestureDeck</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="quick-stats">
                <div>
                  <span className="stat-icon">
                    <Hand size={21} />
                  </span>
                  <div>
                    <small>Saved poses</small>
                    <strong>
                      {gestures.length.toString().padStart(2, '0')}
                      <span>custom poses</span>
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon peach">
                    <Layers size={21} />
                  </span>
                  <div>
                    <small>Presentation modes</small>
                    <strong>
                      02<span>PDF / external slides</span>
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="stat-icon lilac">
                    <ShieldCheck size={21} />
                  </span>
                  <div>
                    <small>Processing</small>
                    <strong>
                      Local<span>No video saved</span>
                    </strong>
                  </div>
                </div>
              </div>
              <div className="section-header">
                <div>
                  <span className="eyebrow">THREE STEPS TO GO HANDS-FREE</span>
                  <h2>Start with one clear pose</h2>
                </div>
                <button className="text-button" onClick={() => navigate('guide')}>
                  Read the full guide <ArrowUpRight size={15} />
                </button>
              </div>
              <div className="start-grid">
                {[
                  {
                    icon: ScanLine,
                    title: 'Get in the frame',
                    text: 'Stand where you will present. Keep your shoulders, elbows and wrists in view.',
                    action: 'Check your camera',
                    target: 'studio' as Page,
                  },
                  {
                    icon: Hand,
                    title: 'Capture your pose',
                    text: 'Capture one still pose for each command. Hold it to change slides, then lower your arms.',
                    action: 'Open Pose Studio',
                    target: 'studio' as Page,
                  },
                  {
                    icon: MonitorPlay,
                    title: 'Take the stage',
                    text: 'Upload a PDF, or connect to Google Slides and Canva.',
                    action: 'Start presenting',
                    target: 'pdf' as Page,
                  },
                ].map((s, i) => (
                  <button
                    className="card start-card"
                    key={s.title}
                    onClick={() => navigate(s.target)}
                  >
                    <div className="start-top">
                      <span>0{i + 1}</span>
                      <s.icon size={24} />
                    </div>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                    <span className="start-link">
                      {s.action}
                      <ArrowRight size={17} />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {hasCamera && (
            <div className="workspace-grid">
              <div className="workspace-main">
                {page === 'studio' && (
                  <GestureStudio
                    packet={packet}
                    cameraActive={cameraActive}
                    gestures={gestures}
                    onSave={(g) => changeGestures([...gestures, g])}
                    onNotice={setNotice}
                  />
                )}
                {page === 'pdf' && (
                  <PdfStage
                    event={lastEvent}
                    live={live}
                    onToggleLive={toggleLive}
                    canControl={cameraActive && activeCount > 0}
                    onNotice={setNotice}
                  />
                )}
                {page === 'lab' && (
                  <div className="lab-content">
                    <div className="card lab-top">
                      <div className="section-title">
                        <div>
                          <span className="eyebrow">LIVE TEST</span>
                          <h2>Rehearse before you present.</h2>
                        </div>
                        <span className="pill green">{activeCount} poses enabled</span>
                      </div>
                      <p className="muted">
                        Commands are logged here without changing slides. Repeat each pose, then
                        speak naturally and watch for accidental triggers.
                      </p>
                      <button
                        className="button primary"
                        onClick={toggleLive}
                        disabled={!live && (!cameraActive || !activeCount)}
                      >
                        {live ? <Pause size={17} /> : <Play size={17} />}{' '}
                        {live ? 'Pause test' : 'Start test'}
                      </button>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={beep}
                          onChange={(e) => setBeep(e.target.checked)}
                        />
                        Play a sound when a command triggers
                      </label>
                      <div className="lab-readout">
                        <small>Current candidate</small>
                        <strong>{status.candidate || 'Waiting for a pose'}</strong>
                        <span>
                          Match index {status.score} / 100 <small>(not an accuracy rate)</small>
                        </span>
                      </div>
                    </div>
                    <div className="card event-log">
                      <div className="section-title">
                        <h3>Command log</h3>
                        <button className="text-button" onClick={() => setEvents([])}>
                          Clear
                        </button>
                      </div>
                      {!events.length ? (
                        <div className="log-empty">
                          <CommandIcon size={26} />
                          <p>
                            Start a test and perform a saved pose.
                            <br />
                            Recognized commands will appear here.
                          </p>
                        </div>
                      ) : (
                        events.slice(0, 20).map((e, i) => (
                          <div className="event-row" key={`${e.time}-${i}`}>
                            <Check size={16} />
                            <div>
                              <b>{e.name}</b>
                              <small>
                                {COMMAND_LABELS[e.command]} · Match index {e.score}
                              </small>
                            </div>
                            <time>
                              {new Date(e.time).toLocaleTimeString('en-CA', { hour12: false })}
                            </time>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="camera-dock">
                <CameraView
                  packet={packet}
                  active={cameraActive}
                  loading={cameraLoading}
                  videoRef={videoRef}
                  onStart={() => void startCamera()}
                  onStop={stopCamera}
                  status={status}
                />
                <div className="dock-note">
                  <MousePointer2 size={16} />
                  <p>
                    Range depends on your camera and lighting. Capture and test from your actual
                    presentation position.
                  </p>
                </div>
              </div>
            </div>
          )}
          {page === 'external' && <ExternalControl gestures={gestures} onNotice={setNotice} />}
          {page === 'guide' && (
            <div className="guide-grid">
              <div className="card guide-card">
                <BookOpen size={25} />
                <h2>Run locally</h2>
                <p>
                  Open the extracted GestureDeck folder in VS Code, then run these commands in its
                  terminal:
                </p>
                <pre>npm install{'\n'}npm run dev</pre>
                <p>
                  In Chrome, open <code>http://localhost:5173</code>. Start the dev server instead
                  of double-clicking index.html.
                </p>
                <h3>Capture & calibration</h3>
                <p>
                  Start the camera and wait for Pose readiness to show Ready to use. A perfect
                  confidence score is not required. Keep both shoulders, elbows and wrists in view.
                  Name your pose, choose a command, and click Capture pose. Get into position during
                  the countdown, hold still for 0.7 seconds, then click Save pose.
                </p>
                <h3>PDF Presentation</h3>
                <p>
                  Upload a PDF or try the sample. Start the camera, enable control, and enter
                  fullscreen. Hold a saved pose to change slides, then lower your arms before using
                  it again. Use arrow keys to navigate, B for black screen, and Esc to pause.
                </p>
                <h3>External Slides</h3>
                <p>
                  Load the current connector/dist in Chrome and refresh the website. Select the
                  Editor tab, allow camera access, and start the camera check. Wait for Ready for
                  Present, then open Present and stay in the slideshow; the connector follows it
                  automatically. Hold a saved pose, lower your arms after the slide changes, and
                  repeat after the brief cooldown.
                </p>
              </div>
              <div className="card guide-card">
                <ShieldCheck size={25} />
                <h2>Make control more reliable</h2>
                <p>
                  Choose poses you would not normally make while speaking. Return to a neutral
                  stance after each command. If accidental triggers occur, lower threshold in your
                  exported JSON profile, or capture more distinct poses. Lower values are stricter.
                </p>
                <p>
                  Recognition uses 2D upper-body positions. Finger pinches, complex turns and
                  multiple people are not supported. Test with your actual lighting and position.
                </p>
                <h3>Pause & resume</h3>
                <p>
                  PDF: press Esc or click Pause control. External slides: Alt + Shift + G pauses or
                  resumes; clicking the extension icon stops the session. Custom pause poses only
                  pause recognition. Resume using a button or the fixed shortcut.
                </p>
                <h3>Backups & privacy</h3>
                <p>
                  Poses are stored in your browser. Clearing site data removes them, so export a
                  JSON backup. The app does not access your microphone or upload PDFs or camera
                  video. Commands go only to your selected presentation tab.
                </p>
                <h3>Before you submit</h3>
                <p>
                  Read docs/ARCHITECTURE.md and docs/TESTING.md. Understand pose normalization,
                  matching, the state machine and platform adapters, and collect your own results.
                </p>
              </div>
            </div>
          )}
          {['home', 'studio', 'lab'].includes(page) && (
            <GestureLibrary
              gestures={gestures}
              onChange={changeGestures}
              onCreate={() => navigate('studio')}
              onNotice={setNotice}
            />
          )}
          <footer className="footer">
            <span>
              <img src="/logo.svg" alt="" /> GestureDeck
            </span>
            <small>YOUR POSE. YOUR NEXT SLIDE.</small>
            <span>
              Made for the way you present <ArrowUpRight size={13} />
            </span>
          </footer>
        </div>
      </main>
      {paletteOpen && (
        <div className="palette-backdrop" onMouseDown={() => setPaletteOpen(false)}>
          <div
            className="palette-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Jump to a page"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="palette-input">
              <Search size={20} />
              <input
                autoFocus
                value={paletteQuery}
                placeholder="Jump to..."
                onChange={(event) => {
                  setPaletteQuery(event.target.value);
                  setPaletteIndex(0);
                }}
              />
              <kbd>Esc</kbd>
            </div>
            <div className="palette-section-label">Workspace</div>
            <div className="palette-list">
              {filteredNavigation.map(([id, Icon, label, shortcut], index) => (
                <button
                  className={index === paletteIndex ? 'active' : ''}
                  key={id}
                  onMouseEnter={() => setPaletteIndex(index)}
                  onClick={() => navigate(id)}
                >
                  <span className="palette-icon">
                    <Icon size={18} />
                  </span>
                  <span>{label}</span>
                  {id === page && <small>Current</small>}
                  <kbd>{shortcut}</kbd>
                </button>
              ))}
            </div>
            <div className="palette-footer">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> Navigate
              </span>
              <span>
                <kbd>↵</kbd> Open
              </span>
            </div>
          </div>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <InfoIcon />
          <span>{notice}</span>
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
function InfoIcon() {
  return <CircleHelp size={19} />;
}
