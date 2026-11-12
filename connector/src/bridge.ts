const allowedOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
const commands = new Set([
  'PING',
  'LIST_TABS',
  'CAMERA_PERMISSION',
  'PREVIEW_VISIBILITY',
  'BIND',
  'START',
  'STOP',
  'PAUSE',
  'COMMAND',
]);
if (allowedOrigins.has(location.origin)) {
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      m?.source !== 'GESTUREDECK_WEB' ||
      !commands.has(m.type) ||
      typeof m.id !== 'string' ||
      m.id.length > 100
    )
      return;
    chrome.runtime
      .sendMessage({ target: 'background', type: m.type, payload: m.payload ?? {} })
      .then((result) => {
        window.postMessage(
          { source: 'GESTUREDECK_CONNECTOR', id: m.id, ...result },
          location.origin,
        );
      })
      .catch((error) => {
        window.postMessage(
          {
            source: 'GESTUREDECK_CONNECTOR',
            id: m.id,
            error: `Connector error: ${error.message}. Refresh this website.`,
          },
          location.origin,
        );
      });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'WEB_STATUS')
      window.postMessage(
        { source: 'GESTUREDECK_CONNECTOR', type: 'STATUS', status: message.status },
        location.origin,
      );
    if (message.type === 'WEB_PREVIEW' && typeof message.preview === 'string')
      window.postMessage(
        { source: 'GESTUREDECK_CONNECTOR', type: 'PREVIEW', preview: message.preview },
        location.origin,
      );
  });
}
