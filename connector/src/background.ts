import { COMMANDS, type Command, type Platform } from '../../src/core/types';
import { validateTemplates } from '../../src/core/storage';

interface Session {
  ownerTabId: number;
  targetTabId: number;
  platform: Platform;
  presentationKey: string;
  targetTitle: string;
  targetView: 'Editor' | 'Slideshow';
  running: boolean;
  paused: boolean;
  error?: string;
  recognition?: string;
  score?: number;
  lastCommand?: string;
  lastDispatch?: number;
  sentCount?: number;
  recognizedCount?: number;
  poseReady?: boolean;
  poseUpdatedAt?: number;
  poseMessage?: string;
  poseQuality?: number;
  recognitionFps?: number;
  captureFps?: number;
  cameraLabel?: string;
  cameraWidth?: number;
  cameraHeight?: number;
}
let creating: Promise<void> | null = null;
let operation = Promise.resolve();
function enqueue<T>(task: () => Promise<T>) {
  const next = operation.then(task);
  operation = next.then(
    () => {},
    () => {},
  );
  return next;
}
const offscreenUrl = chrome.runtime.getURL('offscreen.html');
const permissionUrl = chrome.runtime.getURL('permission.html');
const getSession = async () =>
  (await chrome.storage.session.get('session')).session as Session | undefined;
function allowedWeb(sender: chrome.runtime.MessageSender) {
  try {
    const u = new URL(sender.url ?? '');
    return (
      sender.id === chrome.runtime.id &&
      sender.tab?.id !== undefined &&
      ['http://localhost:5173', 'http://127.0.0.1:5173'].includes(u.origin) &&
      sender.frameId === 0
    );
  } catch {
    return false;
  }
}
function matchesPlatform(url: string, platform: Platform) {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      (platform === 'google'
        ? u.hostname === 'docs.google.com' && u.pathname.startsWith('/presentation/')
        : ['canva.com', 'www.canva.com'].includes(u.hostname) && u.pathname.startsWith('/design/'))
    );
  } catch {
    return false;
  }
}
function presentationKey(url: string, platform: Platform) {
  try {
    const path = new URL(url).pathname;
    const match =
      platform === 'google'
        ? path.match(/\/presentation\/d\/([^/]+)/)
        : path.match(/\/design\/([^/]+)/);
    return match?.[1] ?? '';
  } catch {
    return '';
  }
}
function isPresentationUrl(url: string, platform: Platform) {
  try {
    const u = new URL(url);
    if (!matchesPlatform(url, platform)) return false;
    return platform === 'google'
      ? /\/(present|preview|embed)(\/|$)/.test(u.pathname)
      : /\/(view|present)(\/|$)/.test(u.pathname);
  } catch {
    return false;
  }
}
async function platformTabs(platform: Platform) {
  const tabs = await chrome.tabs.query({
    url:
      platform === 'google'
        ? 'https://docs.google.com/presentation/*'
        : ['https://www.canva.com/*', 'https://canva.com/*'],
  });
  return tabs.filter((t) => t.id !== undefined && matchesPlatform(t.url ?? '', platform));
}
async function saveSession(session: Session, transient: Record<string, unknown> = {}) {
  await chrome.storage.session.set({ session });
  await updateBadge(session);
  await notify({ ...session, ...transient });
}
async function updateBadge(s?: Session) {
  await chrome.action.setBadgeText({
    text: s?.running ? (s.paused ? 'Ⅱ' : s.poseReady ? 'ON' : 'CAM') : '',
  });
  await chrome.action.setBadgeBackgroundColor({ color: s?.paused ? '#a17b47' : '#255442' });
}
async function notify(session: Session) {
  try {
    await chrome.tabs.sendMessage(session.ownerTabId, { type: 'WEB_STATUS', status: session });
  } catch {
    /* UI may be reloading. PING restores state. */
  }
}
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });
  if (contexts.length) return;
  if (!creating)
    creating = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.WORKERS],
        justification:
          'Recognize user-created body poses locally while a presentation tab is foreground.',
      })
      .finally(() => {
        creating = null;
      });
  await creating;
}
async function sendToPresentation<T = unknown>(
  tabId: number,
  message: Record<string, unknown>,
): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['presentation.js'] });
      return (await chrome.tabs.sendMessage(tabId, message)) as T;
    } catch {
      throw new Error(
        'The connector could not attach to the presentation tab. Refresh that Google Slides or Canva tab once, then reconnect.',
      );
    }
  }
}
async function sendPresentationKey(tabId: number, command: 'NEXT_SLIDE' | 'PREVIOUS_SLIDE') {
  const target = { tabId };
  const next = command === 'NEXT_SLIDE';
  const key = next ? 'ArrowRight' : 'ArrowLeft',
    virtualKeyCode = next ? 39 : 37;
  let attached = false,
    delivered = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    const params = {
      key,
      code: key,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    };
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      ...params,
      type: 'rawKeyDown',
    });
    delivered = true;
    try {
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        ...params,
        type: 'keyUp',
      });
    } catch {
      /* Key down already reached the tab; never risk a duplicate DOM fallback. */
    }
    return { ok: true, verified: true, method: `browser-level ${key} key` };
  } catch (error) {
    if (delivered) return { ok: true, verified: true, method: `browser-level ${key} key` };
    throw error;
  } finally {
    if (attached)
      try {
        await chrome.debugger.detach(target);
      } catch {
        /* The tab may have closed after receiving the key. */
      }
  }
}
async function stopSession() {
  const s = await getSession();
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP' });
  } catch {
    /* already stopped */
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });
  if (contexts.length) await chrome.offscreen.closeDocument();
  if (s) {
    try {
      await sendToPresentation(s.targetTabId, { target: 'presentation', type: 'CLEAR_OVERLAY' });
    } catch {}
    await saveSession({
      ...s,
      running: false,
      paused: false,
      poseReady: false,
      poseUpdatedAt: undefined,
      recognition: 'Stopped',
      poseMessage: 'Camera stopped.',
    });
  } else await updateBadge();
}
async function bind(platform: Platform, tabId: number, ownerTabId: number) {
  if (!['google', 'canva'].includes(platform) || !Number.isInteger(tabId))
    throw new Error('Choose a platform and target tab first.');
  const tab = await chrome.tabs.get(tabId);
  if (!matchesPlatform(tab.url ?? '', platform))
    throw new Error('The target tab does not match the selected platform.');
  const key = presentationKey(tab.url ?? '', platform);
  if (!key) throw new Error('The presentation identity could not be read from the target URL.');
  const s: Session = {
    ownerTabId,
    targetTabId: tabId,
    platform,
    presentationKey: key,
    targetTitle: tab.title ?? 'Presentation',
    targetView: isPresentationUrl(tab.url ?? '', platform) ? 'Slideshow' : 'Editor',
    running: false,
    paused: false,
  };
  const probe = await sendToPresentation<{ ok?: boolean; view?: string }>(tabId, {
    target: 'presentation',
    type: 'PROBE',
  });
  if (probe?.ok && ['Editor', 'Slideshow'].includes(probe.view ?? ''))
    s.targetView = probe.view as 'Editor' | 'Slideshow';
  await saveSession(s);
  return s;
}
async function resolvePresentationTarget(session: Session) {
  const current = await chrome.tabs.get(session.targetTabId);
  if (presentationKey(current.url ?? '', session.platform) !== session.presentationKey)
    throw new Error('The target tab has left the selected presentation. Reconnect to your slides.');
  if (isPresentationUrl(current.url ?? '', session.platform)) return { session, tab: current };
  const presentations = (await platformTabs(session.platform)).filter(
    (t) =>
      isPresentationUrl(t.url ?? '', session.platform) &&
      presentationKey(t.url ?? '', session.platform) === session.presentationKey &&
      t.id !== session.ownerTabId,
  );
  const children = presentations.filter((t) => t.openerTabId === session.targetTabId);
  const active = presentations.filter((t) => t.active);
  const choices = children.length
    ? children
    : active.length
      ? active
      : presentations.length === 1
        ? presentations
        : [];
  const target = [...choices].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  if (!target?.id) return { session, tab: current };
  const next = {
    ...session,
    targetTabId: target.id,
    targetTitle: target.title ?? 'Slideshow',
    targetView: 'Slideshow' as const,
    error: undefined,
  };
  await saveSession(next);
  return { session: next, tab: target };
}
async function dispatch(command: Command, automatic = false) {
  let s = await getSession();
  if (!s) throw new Error('Choose a target tab and connect first.');
  if (automatic && (!s.running || s.paused)) return;
  if (!COMMANDS.includes(command)) throw new Error('Unsupported command');
  const now = Date.now();
  if (automatic && now - (s.lastDispatch ?? 0) < 600) return;
  const resolved = await resolvePresentationTarget(s);
  s = resolved.session;
  const tab = resolved.tab;
  if (!matchesPlatform(tab.url ?? '', s.platform))
    throw new Error(
      'The target tab has left the selected platform. Reconnect to your presentation.',
    );
  if (automatic && s.targetView !== 'Slideshow' && !isPresentationUrl(tab.url ?? '', s.platform))
    return { ok: false, ignored: true };
  let result: { ok?: boolean; error?: string; verified?: boolean; method?: string };
  if (command === 'NEXT_SLIDE' || command === 'PREVIOUS_SLIDE') {
    try {
      result = await sendPresentationKey(s.targetTabId, command);
    } catch {
      result = await sendToPresentation(s.targetTabId, {
        target: 'presentation',
        type: 'EXECUTE',
        command,
        platform: s.platform,
      });
    }
  } else
    result = await sendToPresentation(s.targetTabId, {
      target: 'presentation',
      type: 'EXECUTE',
      command,
      platform: s.platform,
    });
  if (result?.error) throw new Error(result.error);
  if (!result?.ok)
    throw new Error('The target page did not respond. Refresh your presentation and try again.');
  await saveSession({
    ...s,
    lastCommand: command,
    lastDispatch: now,
    sentCount: (s.sentCount ?? 0) + 1,
    error: result.verified
      ? undefined
      : 'Navigation button clicked. Check that your presentation changed slides.',
  });
  return result;
}
async function pause(paused: boolean) {
  const s = await getSession();
  if (!s?.running) throw new Error('No active session');
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'PAUSE', paused });
  if (!response?.ok)
    throw new Error(
      response?.error ??
        'The background camera did not respond. Stop and restart the camera check.',
    );
  await saveSession({ ...s, paused, error: undefined });
}

chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (m?.target !== 'background') return;
  const fromOffscreen = sender.id === chrome.runtime.id && sender.url === offscreenUrl;
  const fromPermission = sender.id === chrome.runtime.id && sender.url === permissionUrl;
  const fromPresentation =
    sender.id === chrome.runtime.id &&
    sender.tab?.id !== undefined &&
    sender.frameId === 0 &&
    (matchesPlatform(sender.url ?? '', 'google') || matchesPlatform(sender.url ?? '', 'canva'));
  if (!allowedWeb(sender) && !fromOffscreen && !fromPermission && !fromPresentation) {
    respond({ error: 'Sender not allowed' });
    return;
  }
  // Keep the web page connected while the camera/model is starting. This read
  // must not wait behind START, which can take longer than the ping timeout.
  if (allowedWeb(sender) && m.type === 'PING') {
    void getSession()
      .then((s) =>
        respond({ result: { version: '1.8.0', status: s ?? { running: false, paused: false } } }),
      )
      .catch((e) => respond({ error: (e as Error).message }));
    return true;
  }
  // Preview frames are transient and latency-sensitive. Do not serialize them
  // behind storage writes or persist their base64 payloads in session state.
  if (fromOffscreen && m.type === 'OFFSCREEN_PREVIEW') {
    const preview =
      typeof m.preview === 'string' && m.preview.startsWith('data:image/') ? m.preview : '';
    void getSession()
      .then(async (s) => {
        if (preview && s?.running)
          try {
            await chrome.tabs.sendMessage(s.ownerTabId, { type: 'WEB_PREVIEW', preview });
          } catch {
            /* UI may be hidden or reloading. */
          }
        respond({ result: {} });
      })
      .catch((e) => respond({ error: (e as Error).message }));
    return true;
  }
  const task = async () => {
    const p = m.payload ?? {};
    if (fromOffscreen) {
      if (m.type === 'OFFSCREEN_STATUS') {
        const s = await getSession();
        if (s?.running)
          await saveSession({
            ...s,
            recognition: String(m.status?.state ?? ''),
            score: Number(m.status?.score ?? 0),
            poseReady: Boolean(m.poseReady),
            poseUpdatedAt: Date.now(),
            poseMessage: String(m.poseMessage ?? ''),
            poseQuality: Number(m.poseQuality ?? 0),
            recognitionFps: Number(m.recognitionFps ?? 0),
            captureFps: Number(m.captureFps ?? 0),
            recognizedCount: Number(m.recognizedCount ?? 0),
            cameraLabel: String(m.cameraLabel ?? 'Camera'),
            cameraWidth: Number(m.cameraWidth ?? 0),
            cameraHeight: Number(m.cameraHeight ?? 0),
          });
        return {};
      }
      if (m.type === 'OFFSCREEN_ERROR') {
        await stopSession();
        const s = await getSession();
        if (s) await saveSession({ ...s, error: String(m.error) });
        return {};
      }
      if (m.type === 'OFFSCREEN_COMMAND') {
        if (m.event?.command === 'TOGGLE_CONTROL') {
          await pause(true);
          return {};
        }
        try {
          return await dispatch(m.event?.command, true);
        } catch (e) {
          const s = await getSession();
          if (s) await saveSession({ ...s, error: (e as Error).message });
          return {};
        }
      }
      throw new Error('Unsupported offscreen request');
    }
    if (fromPermission) {
      if (m.type === 'PANEL_STOP') {
        await stopSession();
        return {};
      }
      throw new Error('Unsupported panel request');
    }
    if (fromPresentation) {
      if (m.type !== 'PRESENTATION_STATE') throw new Error('Unsupported presentation request');
      const s = await getSession();
      if (
        !s ||
        !matchesPlatform(sender.url ?? '', s.platform) ||
        presentationKey(sender.url ?? '', s.platform) !== s.presentationKey
      )
        return {};
      const sameTab = sender.tab!.id === s.targetTabId;
      if (sameTab || (s.running && sender.tab!.active && p.view === 'Slideshow'))
        await saveSession({
          ...s,
          targetTabId: sender.tab!.id!,
          targetView: p.view === 'Slideshow' ? 'Slideshow' : 'Editor',
          targetTitle: String(p.title ?? s.targetTitle),
        });
      return {};
    }
    const owner = sender.tab!.id!;
    if (m.type === 'LIST_TABS') {
      if (!['google', 'canva'].includes(p.platform)) throw new Error('Invalid platform');
      return (await platformTabs(p.platform)).map((t) => ({
        id: t.id,
        title: t.title ?? 'Presentation',
        url: t.url,
      }));
    }
    if (m.type === 'CAMERA_PERMISSION') {
      await chrome.tabs.create({ url: permissionUrl });
      return {};
    }
    if (m.type === 'PREVIEW_VISIBILITY') {
      try {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'PREVIEW_VISIBILITY',
          enabled: Boolean(p.enabled),
        });
      } catch {
        /* Camera has not started yet. */
      }
      return {};
    }
    const existing = await getSession();
    if (existing?.running && existing.ownerTabId !== owner)
      throw new Error(
        'Another GestureDeck tab is controlling a presentation. Click the extension icon to stop it first.',
      );
    if (m.type === 'STOP') {
      await stopSession();
      return {};
    }
    if (m.type === 'BIND') {
      if (existing?.running) {
        if (existing.targetTabId !== p.tabId || existing.platform !== p.platform)
          throw new Error('Stop the current session first.');
        return existing;
      }
      return await bind(p.platform, p.tabId, owner);
    }
    if (m.type === 'START') {
      const templates = validateTemplates(p.gestures);
      if (!templates.some((g) => g.enabled)) throw new Error('No poses are enabled.');
      if (existing?.running) await stopSession();
      const session = await bind(p.platform, p.tabId, owner);
      await ensureOffscreen();
      try {
        const response = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'START',
          gestures: templates,
        });
        if (response?.error) throw new Error(response.error);
        if (!response?.ok)
          throw new Error(
            'The background camera did not confirm startup. Reload the current connector and try again.',
          );
        await saveSession({
          ...session,
          running: true,
          poseReady: false,
          recognition: 'CHECKING_CAMERA',
          poseMessage: 'Waiting for continuous camera frames…',
        });
        return { ok: true };
      } catch (e) {
        await stopSession();
        throw e;
      }
    }
    if (m.type === 'PAUSE') {
      await pause(Boolean(p.paused));
      return {};
    }
    if (m.type === 'COMMAND') return await dispatch(p.command);
    throw new Error('Unknown request');
  };
  // Offscreen telemetry is fire-and-forget. Serialize it with UI mutations
  // so stale telemetry cannot undo STOP or PAUSE.
  const next = enqueue(task);
  void next
    .then((result) => respond({ result }))
    .catch((e) => respond({ error: (e as Error).message }));
  return true;
});
chrome.action.onClicked.addListener(() => {
  void enqueue(stopSession).catch(() => {});
});
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-pause')
    void enqueue(async () => {
      const s = await getSession();
      if (s?.running) await pause(!s.paused);
    }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((id) => {
  void enqueue(async () => {
    const s = await getSession();
    if (s && (s.targetTabId === id || s.ownerTabId === id)) await stopSession();
  }).catch(() => {});
});
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (!change.url) return;
  void enqueue(async () => {
    const s = await getSession();
    if (!s?.running) return;
    if (s.targetTabId === id) {
      if (
        !matchesPlatform(change.url!, s.platform) ||
        presentationKey(change.url!, s.platform) !== s.presentationKey
      )
        return stopSession();
      await saveSession({
        ...s,
        targetTitle: tab.title ?? s.targetTitle,
        targetView: isPresentationUrl(change.url!, s.platform) ? 'Slideshow' : 'Editor',
        error: undefined,
      });
      return;
    }
    if (
      tab.openerTabId === s.targetTabId &&
      isPresentationUrl(change.url!, s.platform) &&
      presentationKey(change.url!, s.platform) === s.presentationKey
    )
      await saveSession({
        ...s,
        targetTabId: id,
        targetTitle: tab.title ?? 'Slideshow',
        targetView: 'Slideshow',
        error: undefined,
      });
  }).catch(() => {});
});
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined) return;
  void enqueue(async () => {
    const s = await getSession();
    if (
      s?.running &&
      tab.openerTabId === s.targetTabId &&
      isPresentationUrl(tab.url ?? '', s.platform) &&
      presentationKey(tab.url ?? '', s.platform) === s.presentationKey
    )
      await saveSession({
        ...s,
        targetTabId: tab.id!,
        targetTitle: tab.title ?? 'Slideshow',
        targetView: 'Slideshow',
        error: undefined,
      });
  }).catch(() => {});
});
chrome.tabs.onActivated.addListener((info) => {
  void enqueue(async () => {
    const s = await getSession();
    if (!s?.running) return;
    const tab = await chrome.tabs.get(info.tabId);
    if (
      isPresentationUrl(tab.url ?? '', s.platform) &&
      presentationKey(tab.url ?? '', s.platform) === s.presentationKey
    )
      await saveSession({
        ...s,
        targetTabId: info.tabId,
        targetTitle: tab.title ?? 'Slideshow',
        targetView: 'Slideshow',
        error: undefined,
      });
  }).catch(() => {});
});
