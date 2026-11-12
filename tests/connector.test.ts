import { beforeAll, describe, it, expect, vi } from 'vitest';
import { template } from './fixtures';

let listener: (message: any, sender: any, respond: (v: any) => void) => unknown;
let updatedListener: (id: number, change: any, tab: any) => void;
let createdListener: (tab: any) => void;
let activatedListener: (info: any) => void;
let saved: any;
const sendToTab = vi.fn(async () => ({ ok: true, verified: true, method: 'navigation button' }));
const debuggerAttach = vi.fn(async () => {});
const debuggerSend = vi.fn(async () => ({}));
const debuggerDetach = vi.fn(async () => {});
const tabs = new Map<number, any>([
  [8, { id: 8, title: 'My Canva talk', url: 'https://www.canva.com/design/test/view' }],
  [9, { id: 9, title: 'My Slides', url: 'https://docs.google.com/presentation/d/test/present' }],
  [10, { id: 10, title: 'Unrelated page', url: 'https://example.com/' }],
]);
const owner = { id: 'test-extension', url: 'http://localhost:5173/', tab: { id: 4 }, frameId: 0 };
const request = (type: string, payload: object = {}, sender = owner) =>
  new Promise<any>((resolve) => listener({ target: 'background', type, payload }, sender, resolve));
beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      getURL: (p: string) => `chrome-extension://test-extension/${p}`,
      getContexts: vi.fn(async () => []),
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      sendMessage: vi.fn(async () => ({ ok: true })),
      onMessage: {
        addListener: (f: typeof listener) => {
          listener = f;
        },
      },
    },
    storage: {
      session: {
        get: vi.fn(async () => ({ session: saved })),
        set: vi.fn(async (v: any) => {
          saved = v.session;
        }),
      },
    },
    tabs: {
      get: vi.fn(async (id: number) => tabs.get(id)),
      query: vi.fn(async () => [...tabs.values()]),
      sendMessage: sendToTab,
      create: vi.fn(),
      onRemoved: { addListener: vi.fn() },
      onUpdated: {
        addListener: (f: typeof updatedListener) => {
          updatedListener = f;
        },
      },
      onCreated: {
        addListener: (f: typeof createdListener) => {
          createdListener = f;
        },
      },
      onActivated: {
        addListener: (f: typeof activatedListener) => {
          activatedListener = f;
        },
      },
    },
    scripting: { executeScript: vi.fn(async () => []) },
    debugger: { attach: debuggerAttach, sendCommand: debuggerSend, detach: debuggerDetach },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    commands: { onCommand: { addListener: vi.fn() } },
    offscreen: {
      createDocument: vi.fn(async () => {}),
      closeDocument: vi.fn(async () => {}),
      Reason: { USER_MEDIA: 'USER_MEDIA', WORKERS: 'WORKERS' },
    },
  });
  await import('../connector/src/background');
});
describe('connector boundary with mocked Chrome APIs', () => {
  it('rejects messages from an unrelated origin', async () => {
    const result = await request('PING', {}, { ...owner, url: 'https://example.com/' });
    expect(result.error).toBe('Sender not allowed');
  });
  it('lists only tabs matching the requested platform', async () => {
    const result = await request('LIST_TABS', { platform: 'google' });
    expect(result.result.map((t: any) => t.id)).toEqual([9]);
  });
  it('rejects a target that does not match the selected platform', async () => {
    const result = await request('BIND', { platform: 'canva', tabId: 9 });
    expect(result.error).toMatch(/does not match/);
  });
  it('injects the presentation receiver when the tab was open before the connector reloaded', async () => {
    saved = undefined;
    sendToTab.mockRejectedValueOnce(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );
    const result = await request('BIND', { platform: 'canva', tabId: 8 });
    expect(result.error).toBeUndefined();
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 8 },
      files: ['presentation.js'],
    });
  });
  it('sends a browser-level right-arrow key only to the bound tab', async () => {
    expect((await request('BIND', { platform: 'canva', tabId: 8 })).error).toBeUndefined();
    sendToTab.mockClear();
    debuggerAttach.mockClear();
    debuggerSend.mockClear();
    debuggerDetach.mockClear();
    const result = await request('COMMAND', { command: 'NEXT_SLIDE' });
    expect(result.result.verified).toBe(true);
    expect(debuggerAttach).toHaveBeenCalledWith({ tabId: 8 }, '1.3');
    expect(debuggerSend).toHaveBeenNthCalledWith(
      1,
      { tabId: 8 },
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'rawKeyDown', key: 'ArrowRight', windowsVirtualKeyCode: 39 }),
    );
    expect(debuggerSend).toHaveBeenNthCalledWith(
      2,
      { tabId: 8 },
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'keyUp', key: 'ArrowRight' }),
    );
    expect(debuggerDetach).toHaveBeenCalledWith({ tabId: 8 });
    expect(debuggerAttach).not.toHaveBeenCalledWith({ tabId: 9 }, expect.anything());
  });
  it('sends five automatic Google Slides commands to the same presentation tab', async () => {
    saved = {
      ownerTabId: 4,
      targetTabId: 9,
      platform: 'google',
      presentationKey: 'test',
      targetTitle: 'My Slides',
      targetView: 'Slideshow',
      running: true,
      paused: false,
    };
    const sender = {
      id: 'test-extension',
      url: 'chrome-extension://test-extension/offscreen.html',
    };
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    debuggerSend.mockClear();
    try {
      for (let index = 0; index < 5; index++) {
        now.mockReturnValue(1000 + index * 1800);
        await new Promise<any>((resolve) =>
          listener(
            { target: 'background', type: 'OFFSCREEN_COMMAND', event: { command: 'NEXT_SLIDE' } },
            sender,
            resolve,
          ),
        );
      }
      const debuggerCalls = debuggerSend.mock.calls as unknown as Array<
        [unknown, string, { type?: string }]
      >;
      const keyDowns = debuggerCalls.filter(
        (call) => call[1] === 'Input.dispatchKeyEvent' && call[2]?.type === 'rawKeyDown',
      );
      expect(keyDowns).toHaveLength(5);
      expect(keyDowns.every((call) => (call[0] as { tabId: number }).tabId === 9)).toBe(true);
      expect(saved.sentCount).toBe(5);
    } finally {
      now.mockRestore();
      saved = { ...saved, running: false, paused: false };
    }
  });
  it('falls back to the presentation control when Chrome cannot attach input', async () => {
    expect((await request('BIND', { platform: 'canva', tabId: 8 })).error).toBeUndefined();
    sendToTab.mockClear();
    debuggerAttach.mockRejectedValueOnce(new Error('Another debugger is attached'));
    const result = await request('COMMAND', { command: 'PREVIOUS_SLIDE' });
    expect(result.error).toBeUndefined();
    expect(sendToTab).toHaveBeenCalledWith(
      8,
      expect.objectContaining({ target: 'presentation', command: 'PREVIOUS_SLIDE' }),
    );
  });
  it('does not send a duplicate click when key-up fails after key-down was delivered', async () => {
    expect((await request('BIND', { platform: 'canva', tabId: 8 })).error).toBeUndefined();
    sendToTab.mockClear();
    debuggerSend.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Tab closed late'));
    const result = await request('COMMAND', { command: 'NEXT_SLIDE' });
    expect(result.error).toBeUndefined();
    expect(sendToTab).not.toHaveBeenCalledWith(
      8,
      expect.objectContaining({ command: 'NEXT_SLIDE' }),
    );
  });
  it('retargets an editor to the slideshow tab it opened', async () => {
    saved = undefined;
    tabs.set(11, {
      id: 11,
      title: 'Slides editor',
      url: 'https://docs.google.com/presentation/d/test/edit',
    });
    tabs.set(12, {
      id: 12,
      title: 'Slides presentation',
      url: 'https://docs.google.com/presentation/d/test/present',
      openerTabId: 11,
      lastAccessed: 20,
    });
    expect((await request('BIND', { platform: 'google', tabId: 11 })).error).toBeUndefined();
    sendToTab.mockClear();
    debuggerAttach.mockClear();
    const result = await request('COMMAND', { command: 'NEXT_SLIDE' });
    expect(result.error).toBeUndefined();
    expect(saved.targetTabId).toBe(12);
    expect(debuggerAttach).toHaveBeenCalledWith({ tabId: 12 }, '1.3');
    tabs.delete(11);
    tabs.delete(12);
  });
  it('follows a newly opened slideshow while background control is running', async () => {
    const child = {
      id: 12,
      title: 'Live slideshow',
      url: 'https://docs.google.com/presentation/d/test/present',
      openerTabId: 11,
    };
    saved = {
      ownerTabId: 4,
      targetTabId: 11,
      platform: 'google',
      presentationKey: 'test',
      targetTitle: 'Editor',
      running: true,
      paused: false,
    };
    updatedListener(12, { url: child.url }, child);
    await vi.waitFor(() => expect(saved.targetTabId).toBe(12));
    expect(saved.targetTitle).toBe('Live slideshow');
    saved = {
      ownerTabId: 4,
      targetTabId: 8,
      platform: 'canva',
      presentationKey: 'test',
      targetTitle: 'My Canva talk',
      running: false,
      paused: false,
    };
  });
  it('follows an activated slideshow even when Chrome omits openerTabId', async () => {
    tabs.set(13, {
      id: 13,
      title: 'Fullscreen slides',
      url: 'https://docs.google.com/presentation/d/test/present',
    });
    saved = {
      ownerTabId: 4,
      targetTabId: 11,
      platform: 'google',
      presentationKey: 'test',
      targetTitle: 'Editor',
      targetView: 'Editor',
      running: true,
      paused: false,
    };
    activatedListener({ tabId: 13, windowId: 1 });
    await vi.waitFor(() => expect(saved.targetTabId).toBe(13));
    expect(saved.targetView).toBe('Slideshow');
    tabs.delete(13);
    saved = {
      ownerTabId: 4,
      targetTabId: 8,
      platform: 'canva',
      presentationKey: 'test',
      targetTitle: 'My Canva talk',
      targetView: 'Slideshow',
      running: false,
      paused: false,
    };
  });
  it('does not retarget control to a different presentation deck', async () => {
    tabs.set(14, {
      id: 14,
      title: 'Different deck',
      url: 'https://docs.google.com/presentation/d/other/present',
    });
    saved = {
      ownerTabId: 4,
      targetTabId: 11,
      platform: 'google',
      presentationKey: 'test',
      targetTitle: 'Editor',
      targetView: 'Editor',
      running: true,
      paused: false,
    };
    activatedListener({ tabId: 14, windowId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved.targetTabId).toBe(11);
    tabs.delete(14);
    saved = {
      ownerTabId: 4,
      targetTabId: 8,
      platform: 'canva',
      presentationKey: 'test',
      targetTitle: 'My Canva talk',
      targetView: 'Slideshow',
      running: false,
      paused: false,
    };
  });
  it('accepts a same-tab fullscreen report and rejects reports from another deck', async () => {
    saved = {
      ownerTabId: 4,
      targetTabId: 8,
      platform: 'canva',
      presentationKey: 'test',
      targetTitle: 'Editor',
      targetView: 'Editor',
      running: true,
      paused: false,
    };
    const sender = {
      id: 'test-extension',
      url: 'https://www.canva.com/design/test/edit',
      tab: { id: 8 },
      frameId: 0,
    };
    expect(
      (
        await request(
          'PRESENTATION_STATE',
          { view: 'Slideshow', title: 'Fullscreen Canva' },
          sender,
        )
      ).error,
    ).toBeUndefined();
    expect(saved.targetView).toBe('Slideshow');
    expect(saved.targetTitle).toBe('Fullscreen Canva');
    await request(
      'PRESENTATION_STATE',
      { view: 'Editor', title: 'Other deck' },
      { ...sender, url: 'https://www.canva.com/design/other/edit' },
    );
    expect(saved.targetTitle).toBe('Fullscreen Canva');
  });
  it('stores camera readiness but forwards preview frames only as transient messages', async () => {
    saved = {
      ownerTabId: 4,
      targetTabId: 8,
      platform: 'canva',
      presentationKey: 'test',
      targetTitle: 'My Canva talk',
      targetView: 'Slideshow',
      running: true,
      paused: false,
    };
    sendToTab.mockClear();
    const sender = {
      id: 'test-extension',
      url: 'chrome-extension://test-extension/offscreen.html',
    };
    const result = await new Promise<any>((resolve) =>
      listener(
        {
          target: 'background',
          type: 'OFFSCREEN_STATUS',
          status: { state: 'READY', score: 72 },
          poseReady: true,
          poseMessage: 'Upper body tracked',
          poseQuality: 0.91,
          cameraLabel: 'FaceTime HD Camera',
          cameraWidth: 640,
          cameraHeight: 480,
        },
        sender,
        resolve,
      ),
    );
    expect(result.error).toBeUndefined();
    expect(saved.poseReady).toBe(true);
    expect(saved.poseMessage).toBe('Upper body tracked');
    expect(saved.preview).toBeUndefined();
    await new Promise<any>((resolve) =>
      listener(
        { target: 'background', type: 'OFFSCREEN_PREVIEW', preview: 'data:image/jpeg;base64,test' },
        sender,
        resolve,
      ),
    );
    expect(saved.preview).toBeUndefined();
    expect(sendToTab).toHaveBeenCalledWith(4, {
      type: 'WEB_PREVIEW',
      preview: 'data:image/jpeg;base64,test',
    });
  });
  it('ignores automatic slide gestures while the selected tab is still the editor', async () => {
    tabs.set(15, {
      id: 15,
      title: 'Slides editor',
      url: 'https://docs.google.com/presentation/d/editor-only/edit',
    });
    saved = {
      ownerTabId: 4,
      targetTabId: 15,
      platform: 'google',
      presentationKey: 'editor-only',
      targetTitle: 'Slides editor',
      targetView: 'Editor',
      running: true,
      paused: false,
    };
    sendToTab.mockClear();
    debuggerAttach.mockClear();
    const sender = {
      id: 'test-extension',
      url: 'chrome-extension://test-extension/offscreen.html',
    };
    const result = await new Promise<any>((resolve) =>
      listener(
        { target: 'background', type: 'OFFSCREEN_COMMAND', event: { command: 'NEXT_SLIDE' } },
        sender,
        resolve,
      ),
    );
    expect(result.error).toBeUndefined();
    expect(sendToTab).not.toHaveBeenCalled();
    expect(debuggerAttach).not.toHaveBeenCalled();
    tabs.delete(15);
    saved = {
      ownerTabId: 4,
      targetTabId: 8,
      platform: 'canva',
      presentationKey: 'test',
      targetTitle: 'My Canva talk',
      targetView: 'Slideshow',
      running: false,
      paused: false,
    };
  });
  it('refuses unsupported commands', async () => {
    const result = await request('COMMAND', { command: 'DELETE_FILES' });
    expect(result.error).toMatch(/Unsupported/);
  });
  it('validates gesture data before creating an offscreen camera document', async () => {
    const result = await request('START', {
      platform: 'canva',
      tabId: 8,
      gestures: [{ bad: 'data' }],
    });
    expect(result.error).toBeTruthy();
    expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });
  it('stops a session and clears a presentation overlay', async () => {
    const result = await request('STOP');
    expect(result.error).toBeUndefined();
    expect(saved.running).toBe(false);
    expect(sendToTab).toHaveBeenCalledWith(8, { target: 'presentation', type: 'CLEAR_OVERLAY' });
  });
  it('keeps the website connected while the camera model is still starting', async () => {
    let finish!: (value: unknown) => void;
    const send = vi.mocked(chrome.runtime.sendMessage);
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as any,
    );
    const starting = request('START', { platform: 'canva', tabId: 8, gestures: [template()] });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const ping = await request('PING');
    expect(ping.result.version).toBe('1.8.0');
    expect(ping.result.status.running).toBe(false);
    finish({ ok: true });
    expect((await starting).error).toBeUndefined();
    expect(saved.running).toBe(true);
    expect(saved.poseReady).toBe(false);
    await request('STOP');
  });
});
