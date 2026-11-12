// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { GoogleSlidesAdapter, CanvaAdapter, isPresentationView } from '../connector/src/adapters';

function doc(url: string) {
  return new JSDOM('<!doctype html><html><body></body></html>', { url }).window.document;
}
describe('presentation adapter contract (fixture DOM, not live vendor pages)', () => {
  it('clicks the accessible next-slide button', async () => {
    const d = doc('https://docs.google.com/presentation/d/test/present');
    const b = d.createElement('button');
    b.setAttribute('aria-label', 'Next slide');
    b.getClientRects = () => [{ width: 10 }] as unknown as DOMRectList;
    const clicked = vi.fn(() => {
      d.location.hash = 'slide=next';
    });
    b.addEventListener('click', clicked);
    d.body.append(b);
    const r = await new GoogleSlidesAdapter(d).execute('NEXT_SLIDE');
    expect(clicked).toHaveBeenCalledOnce();
    expect(r.verified).toBe(true);
    expect(r.method).toBe('navigation button');
  });
  it('accepts the short Next label used by slideshow controls', async () => {
    const d = doc('https://docs.google.com/presentation/d/test/present');
    const b = d.createElement('button');
    b.setAttribute('aria-label', 'Next');
    b.getClientRects = () => [{ width: 10 }] as unknown as DOMRectList;
    b.addEventListener('click', () => {
      d.location.hash = 'slide=2';
    });
    d.body.append(b);
    expect((await new GoogleSlidesAdapter(d).execute('NEXT_SLIDE')).verified).toBe(true);
  });
  it('refuses Canva edit view rather than clicking editor UI', async () => {
    await expect(
      new CanvaAdapter(doc('https://www.canva.com/design/test/edit')).execute('NEXT_SLIDE'),
    ).rejects.toThrow(/Presentation view/);
  });
  it('creates and removes a black-screen overlay', async () => {
    const d = doc('https://www.canva.com/design/test/view');
    const a = new CanvaAdapter(d);
    await a.execute('BLACK_SCREEN');
    expect(d.getElementById('gesturedeck-black-screen')).not.toBeNull();
    await a.execute('BLACK_SCREEN');
    expect(d.getElementById('gesturedeck-black-screen')).toBeNull();
  });
  it('refuses Google Slides editor view', async () => {
    await expect(
      new GoogleSlidesAdapter(doc('https://docs.google.com/presentation/d/test/edit')).execute(
        'NEXT_SLIDE',
      ),
    ).rejects.toThrow();
  });
  it('detects same-tab fullscreen without requiring a changed URL', () => {
    const d = doc('https://www.canva.com/design/test/edit');
    expect(isPresentationView(d, 'canva')).toBe(false);
    Object.defineProperty(d, 'fullscreenElement', { value: d.body, configurable: true });
    expect(isPresentationView(d, 'canva')).toBe(true);
    Object.defineProperty(d, 'fullscreenElement', { value: null });
    expect(isPresentationView(d, 'canva')).toBe(false);
  });
  it('detects a Google Slides viewer rendered within an editor URL', () => {
    const d = doc('https://docs.google.com/presentation/d/test/edit');
    d.body.innerHTML = '<div class="punch-viewer-container"></div>';
    expect(isPresentationView(d, 'google')).toBe(true);
  });
});
