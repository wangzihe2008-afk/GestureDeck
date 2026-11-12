import type { Command, Platform } from '../../src/core/types';

export interface AdapterResult {
  ok: boolean;
  method: string;
  verified: boolean;
}
export interface PresentationAdapter {
  platform: Platform;
  execute(command: Command): Promise<AdapterResult>;
}

function documents(root: Document): Document[] {
  const result = [root];
  for (const frame of root.querySelectorAll('iframe')) {
    try {
      if (frame.contentDocument) result.push(frame.contentDocument);
    } catch {
      /* Cross-origin frames remain inaccessible. */
    }
  }
  return result;
}
export function isPresentationView(doc: Document, platform: Platform): boolean {
  const path = doc.location.pathname;
  if (platform === 'google')
    return (
      doc.location.hostname === 'docs.google.com' &&
      /\/presentation\//.test(path) &&
      (/\/(present|preview|embed)(\/|$)/.test(path) ||
        Boolean(doc.fullscreenElement) ||
        documents(doc).some((d) => Boolean(d.querySelector('.punch-viewer-container'))))
    );
  return (
    /(^|\.)canva\.com$/.test(doc.location.hostname) &&
    /\/design\//.test(path) &&
    (/\/(view|present)(\/|$)/.test(path) ||
      Boolean(doc.fullscreenElement) ||
      documents(doc).some((d) =>
        Boolean(
          d.querySelector(
            '[data-testid*="presenter"],[data-testid*="presentation"],[aria-label="Next page"],[aria-label="Next slide"]',
          ),
        ),
      ))
  );
}
function visible(element: HTMLElement) {
  return (
    element.getClientRects().length > 0 &&
    element.getAttribute('aria-disabled') !== 'true' &&
    !(element as HTMLButtonElement).disabled
  );
}
function findNavigationButton(root: Document, next: boolean): HTMLElement | null {
  const pattern = next
    ? /^(next|next (slide|page)|下一[页張张]|下一张幻灯片)(\s|$)/i
    : /^(previous|back|previous (slide|page)|prev (slide|page)|上一[页張张]|上一张幻灯片)(\s|$)/i;
  for (const doc of documents(root))
    for (const el of doc.querySelectorAll<HTMLElement>('button,[role="button"]')) {
      const labels = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('data-tooltip'),
        el.textContent?.trim(),
      ];
      if (visible(el) && labels.some((label) => label && pattern.test(label.trim()))) return el;
    }
  return null;
}
function findKnownNavigation(
  root: Document,
  platform: Platform,
  next: boolean,
): HTMLElement | null {
  const selectors =
    platform === 'google'
      ? next
        ? ['.punch-viewer-nav-v2-forward', '.punch-viewer-nav-v2-next']
        : ['.punch-viewer-nav-v2-back', '.punch-viewer-nav-v2-previous']
      : next
        ? ['[data-testid*="next"]', '[aria-label="Next"]']
        : ['[data-testid*="previous"]', '[data-testid*="back"]', '[aria-label="Previous"]'];
  for (const doc of documents(root))
    for (const selector of selectors) {
      const element = doc.querySelector<HTMLElement>(selector);
      if (
        element &&
        element.getAttribute('aria-disabled') !== 'true' &&
        !(element as HTMLButtonElement).disabled
      )
        return element;
    }
  return null;
}
function marker(doc: Document) {
  return (
    doc.location.href +
    '|' +
    [...doc.querySelectorAll('[aria-current="true"],.punch-viewer-nav-v2-page-number')]
      .map((n) => n.textContent)
      .join('|')
  );
}
function waitForChange(doc: Document, before: string): Promise<boolean> {
  return new Promise((resolve) => {
    let count = 0;
    const timer = setInterval(() => {
      const changed = marker(doc) !== before;
      if (changed || ++count >= 6) {
        clearInterval(timer);
        resolve(changed);
      }
    }, 70);
  });
}

abstract class WebPresentationAdapter implements PresentationAdapter {
  abstract platform: Platform;
  constructor(protected doc: Document = document) {}
  protected abstract isPresentation(): boolean;
  async execute(command: Command): Promise<AdapterResult> {
    if (!this.isPresentation())
      throw new Error(
        'Presentation view was not detected. Open Present / Slideshow and refresh the target page.',
      );
    if (command === 'BLACK_SCREEN') {
      const id = 'gesturedeck-black-screen';
      const existing = this.doc.getElementById(id);
      if (existing) {
        existing.remove();
        return { ok: true, method: 'overlay removed', verified: true };
      }
      const overlay = this.doc.createElement('div');
      overlay.id = id;
      overlay.setAttribute('role', 'button');
      overlay.setAttribute('aria-label', 'GestureDeck black screen; click to restore');
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        background: '#000',
        zIndex: '2147483647',
        cursor: 'pointer',
      });
      overlay.addEventListener('click', () => overlay.remove());
      this.doc.documentElement.appendChild(overlay);
      return { ok: true, method: 'local black-screen overlay', verified: true };
    }
    if (command !== 'NEXT_SLIDE' && command !== 'PREVIOUS_SLIDE')
      throw new Error('This command is handled by the recognizer.');
    const before = marker(this.doc);
    const next = command === 'NEXT_SLIDE';
    const button =
      findNavigationButton(this.doc, next) ?? findKnownNavigation(this.doc, this.platform, next);
    if (button) {
      button.click();
      return {
        ok: true,
        method: 'navigation button',
        verified: await waitForChange(this.doc, before),
      };
    }
    // DOM events are untrusted. These work only when the presentation's own JS accepts them.
    // Never claim this fallback is a real system keypress or a verified slide change.
    const target =
      this.doc.querySelector<HTMLElement>('.punch-viewer-container,[role="application"]') ??
      this.doc.body;
    target.focus();
    const key = next ? 'ArrowRight' : 'ArrowLeft',
      keyCode = next ? 39 : 37;
    for (const type of ['keydown', 'keyup'])
      target.dispatchEvent(
        new KeyboardEvent(type, {
          key,
          code: key,
          keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true,
          view: this.doc.defaultView,
        }),
      );
    const verified = await waitForChange(this.doc, before);
    if (!verified)
      throw new Error(
        'A navigation event was sent, but a slide change could not be confirmed. You may be at the first or last slide, or the platform may have changed. Test manually or switch to PDF mode.',
      );
    return { ok: true, method: 'DOM keyboard fallback', verified };
  }
}
export class GoogleSlidesAdapter extends WebPresentationAdapter {
  platform = 'google' as const;
  protected isPresentation() {
    return isPresentationView(this.doc, this.platform);
  }
}
export class CanvaAdapter extends WebPresentationAdapter {
  platform = 'canva' as const;
  protected isPresentation() {
    return isPresentationView(this.doc, this.platform);
  }
}
