import { requestedBuiltinGame, bundledGameAdapters } from './bundled-games';
import { startFlight } from './flight-host';
import { startNonFlight } from './non-flight';
import './style.css';

const game = requestedBuiltinGame(location.search);
const adapters = { flight: startFlight, 'legacy-sandbox': startFlight, 'static-viewer': startNonFlight, 'bounded-survey': startNonFlight };
try {
  const adapter = bundledGameAdapters.get(game.info.id);
  if (!adapter) throw new Error('This game has no compatible browser host adapter');
  adapters[adapter](game);
} catch (error) {
  // Configuration recovery stays accessible without silently substituting physics.
  const root = document.querySelector('main')!; root.replaceChildren();
  const message = document.createElement('p'); message.id = 'startup-error'; message.setAttribute('role', 'alert');
  message.textContent = `Could not start ${game.info.name}: ${error instanceof Error ? error.message : String(error)}`;
  const recovery = document.createElement('a'); recovery.href = '?game=space-sim'; recovery.textContent = 'Open Space Sim and the game Library';
  root.append(message, recovery);
}
