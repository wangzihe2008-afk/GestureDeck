export {};
const button = document.getElementById('allow') as HTMLButtonElement;
const status = document.getElementById('status')!;
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((t) => t.stop());
    status.textContent =
      'Camera permission granted. Return to GestureDeck and start control. This page is not using the camera now.';
    button.textContent = 'Permission granted ✓';
  } catch (e) {
    status.textContent = `Camera unavailable: ${(e as Error).message}. Allow the camera in Chrome and your system privacy settings, then retry.`;
    button.disabled = false;
  }
});
document.getElementById('stop')!.addEventListener('click', () => {
  void chrome.runtime
    .sendMessage({ target: 'background', type: 'PANEL_STOP' })
    .then(() => {
      status.textContent = 'Session stopped. Camera released.';
    })
    .catch((e) => {
      status.textContent = String(e);
    });
});
