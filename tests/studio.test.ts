// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GestureStudio } from '../src/components/GestureStudio';
import type { GestureTemplate, PosePacket } from '../src/core/types';
import { landmarks, poseSequence } from './fixtures';

describe('pose capture screen', () => {
  let host: HTMLDivElement;
  let root: Root;
  let packet: PosePacket;
  let onSave: ReturnType<typeof vi.fn<(gesture: GestureTemplate) => void>>;

  const pose = poseSequence();

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    packet = makePacket(0, pose[0].values);
    onSave = vi.fn<(gesture: GestureTemplate) => void>();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  async function render() {
    await act(async () =>
      root.render(
        createElement(GestureStudio, {
          packet,
          cameraActive: true,
          gestures: [],
          onSave,
          onNotice: vi.fn(),
        }),
      ),
    );
  }

  async function setValue(element: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        element,
        value,
      );
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function capturePose() {
    const button = [...host.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Capture pose'),
    ) as HTMLButtonElement;

    await act(async () => button.click());
    await act(async () => vi.advanceTimersByTime(2800));

    packet = makePacket(performance.now(), pose[0].values);
    await render();
    await act(async () => vi.advanceTimersByTime(250));

    for (let index = 0; index < pose.length; index++) {
      await act(async () => vi.advanceTimersByTime(80));
      packet = makePacket(performance.now(), pose[index].values);
      await render();
    }

    await act(async () => vi.advanceTimersByTime(100));
  }

  it('captures and saves one stable pose without a confirmation take', async () => {
    await render();
    await setValue(host.querySelector('input')!, 'Right arm raised');
    await capturePose();

    expect(host.textContent).toContain('1 / 1 captured');
    expect(host.textContent).toContain('stable frames captured');
    expect(host.textContent).toContain('Save pose');
    expect(host.textContent).not.toContain('take 2');

    const save = [...host.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Save pose'),
    ) as HTMLButtonElement;

    await act(async () => save.click());

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].mode).toBe('pose');
  });
});

function makePacket(time: number, values: number[]): PosePacket {
  return {
    time,
    landmarks: landmarks(),
    frame: { t: time, values: [...values] },
    quality: 1,
    message: '',
    fps: 15,
    width: 640,
    height: 480,
  };
}
