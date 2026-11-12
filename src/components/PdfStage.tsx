import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  FileUp,
  Maximize,
  MonitorOff,
  FileText,
  Play,
  Pause,
} from 'lucide-react';
import { PdfController } from '../pdf/PdfController';
import type { RecognitionEvent } from '../core/types';

export function PdfStage({
  event,
  live,
  onToggleLive,
  canControl,
  onNotice,
}: {
  event: RecognitionEvent | null;
  live: boolean;
  onToggleLive: () => void;
  canControl: boolean;
  onNotice: (text: string) => void;
}) {
  const controller = useRef(new PdfController());
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [black, setBlack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const lastEvent = useRef(event); // Mounting must never replay an earlier command.
  useEffect(
    () => () => {
      void controller.current.dispose();
    },
    [],
  );
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width - 32, h: entry.contentRect.height - 32 }),
    );
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (pages && canvas.current && size.w > 0 && size.h > 0)
      void controller.current
        .render(canvas.current, page, size.w, size.h)
        .catch((e) => setError((e as Error).message));
  }, [pages, page, size]);
  function move(delta: number) {
    setPage((p) => Math.max(1, Math.min(pages, p + delta)));
  }
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target?.closest('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (target?.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        move(1);
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        move(-1);
      }
      if (e.key.toLowerCase() === 'b') setBlack((b) => !b);
      if (e.key === 'Escape') {
        setBlack(false);
        setExpanded(false);
        if (live) onToggleLive();
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [pages, live, onToggleLive]);
  useEffect(() => {
    if (!event || event === lastEvent.current) return;
    lastEvent.current = event;
    if (event.command === 'NEXT_SLIDE') move(1);
    if (event.command === 'PREVIOUS_SLIDE') move(-1);
    if (event.command === 'BLACK_SCREEN') setBlack((b) => !b);
  }, [event, pages]);
  async function load(file: File) {
    if (file.size > 100 * 1024 * 1024) {
      setError('PDF files must be 100 MB or smaller.');
      return;
    }
    setBusy(true);
    setError('');
    setPages(0);
    setBlack(false);
    try {
      const count = await controller.current.load(new Uint8Array(await file.arrayBuffer()));
      setPages(count);
      setPage(1);
      setName(file.name);
    } catch (e) {
      setError(
        (e as Error).name === 'PasswordException'
          ? 'Password-protected PDFs are not supported. Remove the password before uploading.'
          : `Could not read PDF: ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function sample() {
    try {
      const r = await fetch('/demo.pdf');
      if (!r.ok) throw new Error('The sample PDF could not be found');
      await load(new File([await r.blob()], 'GestureDeck-demo.pdf', { type: 'application/pdf' }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function enterFullscreen() {
    try {
      await stage.current!.requestFullscreen();
    } catch {
      setExpanded(true);
      onNotice('Page fullscreen is on. Press Esc to exit.');
    }
  }
  function exitFullscreen() {
    setExpanded(false);
    if (document.fullscreenElement) void document.exitFullscreen();
  }
  return (
    <div className="pdf-content">
      <div className="card pdf-card">
        <div className="panel-heading">
          <span>
            <FileText size={18} />
            {name || 'PDF stage'}
          </span>
          <button className="text-button" onClick={() => input.current?.click()} disabled={busy}>
            <FileUp size={15} />
            {pages ? 'Change PDF' : 'Upload PDF'}
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            if (e.target.files?.[0]) void load(e.target.files[0]);
            e.target.value = '';
          }}
        />
        <div
          ref={stage}
          className={`pdf-stage ${pages ? 'loaded' : ''} ${expanded ? 'expanded' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file && !busy) void load(file);
          }}
        >
          <canvas
            ref={canvas}
            style={{ display: pages ? 'block' : 'none' }}
            aria-label={`PDF page ${page}`}
          />
          {!pages && (
            <div className="pdf-empty">
              <div className="file-stack">
                <FileText size={40} />
              </div>
              <h2>{busy ? 'Loading PDF…' : 'Your presentation starts here'}</h2>
              <p>
                Drop in a PDF or choose a local file.
                <br />
                Your presentation stays on your device.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                <FileUp size={17} />
                Choose PDF
              </button>
              <button className="text-button" disabled={busy} onClick={() => void sample()}>
                Try a sample presentation <ArrowRight size={15} />
              </button>
            </div>
          )}
          {black && pages > 0 && (
            <div className="black-screen" onClick={() => setBlack(false)}>
              <small>Black screen · Click to restore · B to toggle</small>
            </div>
          )}
          <div className="fullscreen-hud">
            <span>
              {page} / {pages}
            </span>
            <button onClick={() => move(-1)} aria-label="Previous slide">
              <ArrowLeft />
            </button>
            <button onClick={() => move(1)} aria-label="Next slide">
              <ArrowRight />
            </button>
            <button onClick={exitFullscreen} aria-label="Exit fullscreen">
              Exit
            </button>
          </div>
        </div>
        <div className="pdf-toolbar">
          <div className="page-switch">
            <button
              className="icon-button"
              disabled={!pages || page === 1}
              onClick={() => move(-1)}
              aria-label="Previous slide"
            >
              <ArrowLeft size={19} />
            </button>
            <span>{pages ? `${page} / ${pages}` : '— / —'}</span>
            <button
              className="icon-button"
              disabled={!pages || page === pages}
              onClick={() => move(1)}
              aria-label="Next slide"
            >
              <ArrowRight size={19} />
            </button>
          </div>
          <div className="toolbar-actions">
            <button
              className="icon-button"
              disabled={!pages}
              onClick={() => setBlack((b) => !b)}
              aria-label="Toggle black screen"
              title="Black screen / B"
            >
              <MonitorOff size={19} />
            </button>
            <button
              className="icon-button"
              disabled={!pages}
              onClick={() => void enterFullscreen()}
              aria-label="Fullscreen"
              title="Fullscreen"
            >
              <Maximize size={19} />
            </button>
          </div>
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="live-bar card">
        <div>
          <span className={`status-dot ${live ? 'online' : ''}`} />
          <strong>{live ? 'Pose control enabled' : 'Ready when you are'}</strong>
          <p>
            {live
              ? 'Leave each pose and return to neutral before using it again.'
              : 'Start the camera, save a pose, then enable control.'}
          </p>
        </div>
        <button
          className={`button ${live ? 'secondary' : 'primary'}`}
          disabled={!live && (!canControl || !pages)}
          onClick={onToggleLive}
        >
          {live ? <Pause size={17} /> : <Play size={17} />}{' '}
          {live ? 'Pause control' : 'Enable control'}
        </button>
      </div>
      <div className="keyboard-hints">
        <span>Keyboard backup</span>
        <kbd>←</kbd>
        <kbd>→</kbd>
        <span>Navigate</span>
        <kbd>B</kbd>
        <span>Black screen</span>
        <kbd>Esc</kbd>
        <span>Pause control</span>
      </div>
    </div>
  );
}
