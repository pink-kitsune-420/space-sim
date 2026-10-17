import { FloatingWindow } from './floating-window';
import type { Workspace } from './workspace';

/** Float the existing live readouts, retaining one set of values and their original IDs. */
export function initFlightWindows(workspace: Workspace): void {
  const viewport = document.querySelector<HTMLElement>('#flight-console .viewport')!;
  const trajectory = new FloatingWindow({
    id: 'trajectory', title: 'Trajectory', icon: 'trajectory', container: viewport, pinned: true,
    place: () => ({ x: 24, y: 100 }),
  });
  trajectory.body.append(document.querySelector<HTMLElement>('.path-card')!);
  workspace.addInstrument(trajectory, 'Trajectory', 'Coast prediction: periapsis, apoapsis and impact');

  // Telemetry borrows the Instruments window's live module panels while it is open.
  const card = document.getElementById('module-panels')!;
  const anchor = document.createComment('Telemetry source location');
  card.before(anchor);
  const telemetry = new FloatingWindow({
    id: 'telemetry', title: 'Telemetry', icon: 'telemetry', container: viewport, pinned: true,
    place: () => ({ x: 390, y: 100 }),
  });
  const empty = document.createElement('p');
  empty.className = 'flight-window-empty';
  empty.textContent = 'Turn on Telemetry in the Instruments window to show readings.';
  telemetry.body.append(empty);
  const updateEmpty = (): void => { empty.hidden = card.childElementCount > 0 && !card.hidden; };
  new MutationObserver(updateEmpty).observe(card, { childList: true, attributes: true, attributeFilter: ['hidden'] });
  updateEmpty();
  const placeCard = (): void => {
    if (telemetry.isOpen) telemetry.body.append(card);
    else if (card.parentNode !== anchor.parentNode || card.previousSibling !== anchor) anchor.after(card);
  };
  telemetry.onChange(placeCard);
  placeCard();
  workspace.addInstrument(telemetry, 'Telemetry', 'Live readouts from your instrument modules');
}
