import { CanvaAdapter, GoogleSlidesAdapter, isPresentationView } from './adapters';
import { COMMANDS, type Command } from '../../src/core/types';
const context = globalThis as typeof globalThis & { __gestureDeckPresentationLoaded?: boolean };
if (!context.__gestureDeckPresentationLoaded) {
  context.__gestureDeckPresentationLoaded = true;
  const platform = location.hostname === 'docs.google.com' ? 'google' : 'canva';
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message.target !== 'presentation') return;
    if (message.type === 'PROBE') {
      respond({
        ok: true,
        view: isPresentationView(document, platform) ? 'Slideshow' : 'Editor',
        title: document.title,
      });
      return;
    }
    if (message.type === 'CLEAR_OVERLAY') {
      document.getElementById('gesturedeck-black-screen')?.remove();
      respond({ ok: true });
      return;
    }
    if (message.type !== 'EXECUTE' || !COMMANDS.includes(message.command as Command)) return;
    const adapter =
      message.platform === 'google'
        ? new GoogleSlidesAdapter()
        : message.platform === 'canva'
          ? new CanvaAdapter()
          : null;
    if (!adapter) {
      respond({ error: 'Unknown platform' });
      return;
    }
    void adapter
      .execute(message.command)
      .then(respond)
      .catch((e) => respond({ error: (e as Error).message }));
    return true;
  });
  let previousView = '';
  function reportView() {
    const view = isPresentationView(document, platform) ? 'Slideshow' : 'Editor';
    if (view === previousView) return;
    previousView = view;
    void chrome.runtime
      .sendMessage({
        target: 'background',
        type: 'PRESENTATION_STATE',
        payload: { view, title: document.title },
      })
      .catch(() => {});
  }
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver(() => {
    if (scheduled !== undefined) return;
    scheduled = setTimeout(() => {
      scheduled = undefined;
      reportView();
    }, 200);
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('fullscreenchange', reportView);
  window.addEventListener('pageshow', reportView);
  window.addEventListener('popstate', reportView);
  reportView();
}
