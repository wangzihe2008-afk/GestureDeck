// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../src/components/AppErrorBoundary';

describe('page recovery', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the actual error and can retry a transient failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let fail = true;
    function Child() {
      if (fail) throw new Error('Temporary drawing failure');
      return createElement('p', null, 'Recovered');
    }
    await act(async () => root.render(createElement(AppErrorBoundary, null, createElement(Child))));
    expect(host.textContent).toContain('Temporary drawing failure');
    fail = false;
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
    expect(host.textContent).toContain('Recovered');
    await act(async () => root.unmount());
    host.remove();
  });
});
