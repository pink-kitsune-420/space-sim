import assets from 'virtual:space-sim-client';
import { run } from './server';

run(process.argv.slice(2), assets).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
