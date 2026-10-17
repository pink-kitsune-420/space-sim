# Browser Application

Spacelab's web application hosts the Space Sim simulation and owns the simulation lifecycle, keyboard and touch/pointer controls, rendering cadence, camera selection, mouse/touch panning, and real-time orbital HUD.

- `src/session.ts` gives the frame loop one interface over local solo or peer-to-peer hosted worlds (`LocalSession`) and remote dedicated servers (`RemoteSession`).
- `src/webrtc.ts` connects a browser host and peers with hand-swapped invite and reply codes.
- `src/identity.ts` keeps player identity and reconnect tokens in local storage.
- The flight screen fills the browser window on desktop and mobile with touch controls and gamepad support.

Run `npm run dev` from the project root for local development, and `npm run build` to bundle the production distribution into `dist/`.
