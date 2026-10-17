/** Minimal line icons for the HUD dock and window chrome; stroked with the current text colour. */
const PATHS = {
  setup: '<circle cx="12" cy="12" r="4.5"/><ellipse cx="12" cy="12" rx="10" ry="3.6" transform="rotate(-24 12 12)"/>',
  ship: '<path d="M12 2.5 17 15l-5-2.6L7 15z"/><path d="M10 17.5 12 21.5l2-4"/>',
  fleet: '<path d="M7.5 3 11 12l-3.5-2L4 12z"/><path d="M16.5 10 20 19l-3.5-2-3.5 2z"/>',
  online: '<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="m8.2 10.9 7.6-3.8M8.2 13.1l7.6 3.8"/>',
  instruments: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-5.5"/><path d="M4 20h16"/>',
  trajectory: '<ellipse cx="12" cy="12" rx="9.5" ry="5.5"/><circle cx="12" cy="12" r="1.8"/><circle cx="20.6" cy="9.6" r="1.4" fill="currentColor"/>',
  telemetry: '<path d="M3 12h4l2.2-5.5 4.2 11 2.2-5.5H21"/>',
  chat: '<path d="M4 5h16v11H9.5L4 20z"/><path d="M8 9.5h8M8 12.5h5"/>',
  settings: '<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="9.5" cy="17" r="2.3"/>',
  tools: '<path d="M14.6 5.2a4.2 4.2 0 0 0-5.2 5.4L4 16l4 4 5.4-5.4a4.2 4.2 0 0 0 5.4-5.2l-2.6 2.6-2.6-.6-.6-2.6z"/>',
  library: '<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>',
  manual: '<path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z"/><path d="M12 6.5v13"/>',
  pin: '<path d="M9 3.5h6l-1 6.5 3 3H7l3-3z"/><path d="M12 13v7.5"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): string {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}
