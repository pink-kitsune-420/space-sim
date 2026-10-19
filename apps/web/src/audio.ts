import type { FlightAudioControl, FlightAudioFactory } from '../../../packages/game-api/src/index';
/** Borrow the target-selected factory; its candidate owns provider disposal. */
export function mountFlightAudio(root: HTMLElement, factory?: FlightAudioFactory): FlightAudioControl {
  if (!factory) {
    const hidden = root.hidden; root.hidden = true;
    const idle = () => {};
    return { setProvider: idle, update: idle, play: idle, reset: idle, contact: idle, terrainContact: idle, status: idle, flight: idle,
      dispose() { root.hidden = hidden; } };
  }
  return factory.mount({ root, prefix: 'sound',
    storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) } });
}
