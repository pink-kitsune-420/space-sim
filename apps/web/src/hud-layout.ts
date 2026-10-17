/** Measure only when HUD dimensions change; keep chat clear of the central instruments. */
export function initHudLayout(): void {
  const viewport = document.querySelector<HTMLElement>('#flight-console .viewport')!;
  const chat = document.getElementById('chat-overlay')!;
  const telemetry = viewport.querySelector<HTMLElement>('.telemetry')!;
  const update = (): void => {
    const chatBounds = chat.getBoundingClientRect();
    const instruments = telemetry.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    const defaultBottom = bounds.bottom - 12;
    const overlaps = chatBounds.height > 0 && chatBounds.right + 12 > instruments.left
      && chatBounds.left - 12 < instruments.right
      && chatBounds.bottom + 12 > defaultBottom - instruments.height && chatBounds.top - 12 < defaultBottom;
    viewport.style.setProperty('--chat-telemetry-inset', `${Math.max(12, Math.ceil(bounds.bottom - chatBounds.top + 12))}px`);
    viewport.classList.toggle('chat-overlaps-telemetry', overlaps);
  };
  viewport.addEventListener('hud-layout-change', update);
  const observer = new ResizeObserver(update);
  for (const element of [viewport, chat, telemetry]) observer.observe(element);
}
