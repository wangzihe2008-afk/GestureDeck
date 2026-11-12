import type { Command, GestureTemplate, Platform } from '../core/types';
export interface TargetTab {
  id: number;
  title: string;
  url: string;
}
export interface ConnectorStatus {
  running: boolean;
  paused: boolean;
  platform?: Platform;
  targetTitle?: string;
  targetView?: 'Editor' | 'Slideshow';
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
  preview?: string;
}
export class ConnectorClient {
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  onStatus?: (status: ConnectorStatus) => void;
  onPreview?: (preview: string) => void;
  constructor() {
    window.addEventListener('message', this.receive);
  }
  private receive = (e: MessageEvent) => {
    if (
      e.source !== window ||
      e.origin !== location.origin ||
      e.data?.source !== 'GESTUREDECK_CONNECTOR'
    )
      return;
    if (e.data.type === 'STATUS') {
      this.onStatus?.(e.data.status);
      return;
    }
    if (e.data.type === 'PREVIEW' && typeof e.data.preview === 'string') {
      this.onPreview?.(e.data.preview);
      return;
    }
    const job = this.pending.get(e.data.id);
    if (!job) return;
    clearTimeout(job.timer);
    this.pending.delete(e.data.id);
    if (e.data.error) job.reject(new Error(e.data.error));
    else job.resolve(e.data.result);
  };
  request<T>(type: string, payload: object = {}, timeout = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            'No response from the connector. Install connector/dist and refresh this website.',
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      window.postMessage({ source: 'GESTUREDECK_WEB', id, type, payload }, location.origin);
    });
  }
  ping() {
    return this.request<{ version: string; status: ConnectorStatus }>('PING', {}, 1800);
  }
  tabs(platform: Platform) {
    return this.request<TargetTab[]>('LIST_TABS', { platform });
  }
  cameraPermission() {
    return this.request('CAMERA_PERMISSION');
  }
  previewVisibility(enabled: boolean) {
    return this.request('PREVIEW_VISIBILITY', { enabled }, 3000);
  }
  bind(platform: Platform, tabId: number) {
    return this.request('BIND', { platform, tabId });
  }
  start(platform: Platform, tabId: number, gestures: GestureTemplate[]) {
    return this.request('START', { platform, tabId, gestures }, 90000);
  }
  stop() {
    return this.request('STOP');
  }
  pause(paused: boolean) {
    return this.request('PAUSE', { paused });
  }
  command(command: Command) {
    return this.request<{ ok: boolean; method?: string }>('COMMAND', { command });
  }
  dispose() {
    window.removeEventListener('message', this.receive);
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(new Error('Connection closed'));
    }
    this.pending.clear();
  }
}
