export function raiseWindow(panel: HTMLElement, viewport: HTMLElement): void {
  for (const window of viewport.querySelectorAll('.flight-window,.chat-overlay')) window.classList.toggle('front', window === panel);
}

/** Pointer/touch and keyboard resizing for the HUD's independent windows. */
export function attachWindowResize(panel: HTMLElement, viewport: HTMLElement, title: string, options: {
  start?: () => void;
  change: (width: number, height: number) => void;
  end: () => void;
}): void {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'window-resize';
  handle.setAttribute('aria-label', `Resize ${title} window`);
  handle.title = 'Drag to resize; arrow keys resize the window';
  handle.textContent = '◢';
  panel.append(handle);
  let drag: { pointer: number; x: number; y: number; width: number; height: number } | undefined;
  function size(width: number, height: number): void {
    const bounds = panel.getBoundingClientRect(), container = viewport.getBoundingClientRect();
    const availableWidth = Math.max(1, container.right - bounds.left - 8);
    const availableHeight = Math.max(1, container.bottom - bounds.top - 8);
    options.change(
      Math.max(Math.min(240, availableWidth), Math.min(width, availableWidth)),
      Math.max(Math.min(120, availableHeight), Math.min(height, availableHeight)),
    );
  }
  handle.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    raiseWindow(panel, viewport);
    options.start?.();
    const bounds = panel.getBoundingClientRect();
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    size(drag.width + event.clientX - drag.x, drag.height + event.clientY - drag.y);
  });
  const end = (): void => { if (drag) { drag = undefined; options.end(); } };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('lostpointercapture', end);
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    options.start?.();
    const bounds = panel.getBoundingClientRect(), step = event.shiftKey ? 32 : 8;
    size(bounds.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      bounds.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
    options.end();
  });
}
