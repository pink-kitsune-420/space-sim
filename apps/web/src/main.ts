import { loadingStage, loadingComplete, loadingFailure } from './loading';
import { requestedBuiltinGame, bundledGameAdapters } from './bundled-games';
import { startFlight } from './flight-host';
import { startNonFlight } from './non-flight';
import './style.css';

async function boot(): Promise<void> {
await loadingStage('Checking packages');
const game = requestedBuiltinGame(location.search);
const adapters = { flight: startFlight, 'legacy-sandbox': startFlight, 'static-viewer': startNonFlight, 'bounded-survey': startNonFlight };
try {
  const adapter = bundledGameAdapters.get(game.info.id);
  if (!adapter) throw new Error('This game has no compatible browser host adapter');
  await adapters[adapter](game);
  if (adapter === 'static-viewer' || adapter === 'bounded-survey') await loadingComplete();
} catch (error) {
  loadingFailure(error);
}
}
void boot();
