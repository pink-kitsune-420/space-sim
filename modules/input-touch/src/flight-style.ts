// Editable first-party flight overlay styles. Mounted and removed with the overlay.
export const FLIGHT_TOUCH_STYLE = `/* On-Screen Touch Overlay Controller */
.touch-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 25;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.touch-overlay.disabled,
.touch-overlay[hidden] {
  display: none !important;
}

/* Left Virtual Joystick */
.touch-stick-zone {
  position: absolute;
  left: 16px;
  bottom: calc(62px + env(safe-area-inset-bottom, 0px));
  width: 124px;
  height: 124px;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.touch-stick-base {
  width: 112px;
  height: 112px;
  border-radius: 50%;
  background: var(--ui-win-bg);
  border: 1.5px solid color-mix(in srgb, var(--ui-win-accent) 34%, transparent);
  backdrop-filter: blur(8px);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.touch-stick-crosshair {
  position: absolute;
  inset: 22px;
  border-radius: 50%;
  border: 1px dashed color-mix(in srgb, var(--ui-win-accent) 18%, transparent);
}
.touch-stick-crosshair::before,
.touch-stick-crosshair::after {
  content: '';
  position: absolute;
  background: color-mix(in srgb, var(--ui-win-accent) 16%, transparent);
}
.touch-stick-crosshair::before {
  top: 50%;
  left: -8px;
  right: -8px;
  height: 1px;
}
.touch-stick-crosshair::after {
  left: 50%;
  top: -8px;
  bottom: -8px;
  width: 1px;
}
.touch-stick-hint {
  position: absolute;
  font: 600 9px ui-monospace, monospace;
  color: color-mix(in srgb, var(--ui-win-accent) 45%, transparent);
  pointer-events: none;
  line-height: 1;
}
.touch-hint-up { top: 6px; left: 50%; transform: translateX(-50%); }
.touch-hint-down { bottom: 6px; left: 50%; transform: translateX(-50%); }
.touch-hint-left { left: 7px; top: 50%; transform: translateY(-50%); }
.touch-hint-right { right: 7px; top: 50%; transform: translateY(-50%); }
.touch-stick-knob {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--ui-win-card-bg);
  border: 1.5px solid var(--ui-win-accent);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.6), 0 0 12px color-mix(in srgb, var(--ui-win-accent) 28%, transparent), inset 0 1px 1px rgba(255, 255, 255, 0.2);
  position: absolute;
  will-change: transform;
}

/* Right Touch Actions & Drag-to-Zoom Strip */
.touch-actions-zone {
  position: absolute;
  right: max(16px, var(--hud-dock-inset, 0px));
  bottom: calc(62px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  pointer-events: auto;
}
.touch-right-deck {
  display: flex;
  align-items: stretch;
  gap: 8px;
}
.touch-zoom-strip {
  width: 38px;
  border-radius: 10px;
  background: var(--ui-win-card-bg);
  border: 1px solid color-mix(in srgb, var(--ui-win-accent) 32%, transparent);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: space-between;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  touch-action: none;
  cursor: ns-resize;
}
.touch-zoom-strip.active {
  border-color: var(--ui-win-accent);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.6), 0 0 12px color-mix(in srgb, var(--ui-win-accent) 28%, transparent);
}
.touch-zoom-step {
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: var(--ui-win-card-bg);
  color: var(--ui-win-accent);
  font: 700 14px ui-monospace, monospace;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
}
.touch-zoom-step:hover,
.touch-zoom-step:active {
  background: var(--ui-win-active-bg);
}
.touch-zoom-track {
  flex: 1;
  min-height: 54px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border-top: 1px solid color-mix(in srgb, var(--ui-win-accent) 15%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--ui-win-accent) 15%, transparent);
}
.touch-zoom-track::before {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  border-radius: 1px;
  background: color-mix(in srgb, var(--ui-win-accent) 18%, transparent);
}
.touch-zoom-thumb {
  position: relative;
  z-index: 1;
  width: 30px;
  height: 22px;
  border-radius: 5px;
  background: var(--ui-win-card-bg);
  border: 1px solid color-mix(in srgb, var(--ui-win-accent) 55%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  transition: transform 0.06s ease-out;
  will-change: transform;
}
.touch-zoom-thumb span {
  font: 700 7px ui-monospace, monospace;
  letter-spacing: 0.4px;
  color: var(--ui-win-accent);
}
.touch-flight-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.touch-aux-cluster {
  display: grid;
  grid-template-columns: repeat(2, 48px);
  gap: 6px;
}
.touch-btn {
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--ui-win-accent) 32%, transparent);
  background: var(--ui-win-card-bg);
  color: #d7ece4;
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: ui-monospace, monospace;
  cursor: pointer;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  transition: transform 0.08s ease-out, background 0.08s ease-out, border-color 0.08s ease-out;
}
.touch-btn:active,
.touch-btn.active {
  background: var(--ui-win-active-bg);
  border-color: var(--ui-win-accent);
  color: #ffffff;
  box-shadow: 0 0 14px color-mix(in srgb, var(--ui-win-accent) 45%, transparent);
  transform: scale(0.95);
}
.touch-btn-aux {
  width: 48px;
  height: 34px;
  padding: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
}
.touch-btn-sling {
  grid-column: span 2;
  width: 102px;
  height: 32px;
  border-color: color-mix(in srgb, var(--ui-win-accent) 45%, transparent);
  background: var(--ui-win-card-bg);
  color: var(--ui-win-accent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
}
.touch-btn-sling.active,
.touch-btn-sling.toggled,
.touch-btn-sling.holding {
  background: var(--ui-win-active-bg);
  border-color: var(--ui-win-accent);
  color: #ffffff;
  box-shadow: 0 0 16px color-mix(in srgb, var(--ui-win-accent) 55%, transparent);
}
.touch-btn-burn {
  width: 102px;
  height: 48px;
  padding: 0 10px;
  border-radius: 10px;
   gap: 6px;
  border: 1.5px solid color-mix(in srgb, var(--ui-win-accent) 65%, transparent);
  background: var(--ui-win-card-bg);
  color: #eafff6;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 1.2px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55), 0 0 14px color-mix(in srgb, var(--ui-win-accent) 20%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.touch-burn-icon {
  font-size: 10px;
  color: var(--ui-win-accent);
}
.touch-btn-burn:active,
.touch-btn-burn.active {
  background: var(--ui-win-active-bg);
  border-color: var(--ui-win-accent);
  color: #ffffff;
  box-shadow: 0 0 24px color-mix(in srgb, var(--ui-win-accent) 75%, transparent);
  transform: scale(0.95);
}

`;
