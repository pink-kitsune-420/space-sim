import type { ModuleInitialization } from '@space-sim/game-api';
export default function initialize(context: ModuleInitialization): void {
  const color = context.assets['color.txt']!.trim();
  context.contributeLayer({ name: 'label', label: 'Local label', draw: () => [
    { kind: 'text', space: 'screen', at: { x: 24, y: 80 }, text: 'LOCAL MODULE', color },
  ] });
  context.contributePanel({ name: 'telemetry', title: 'Local telemetry', update: view => [
    { label: 'Time', value: view.time.toFixed(2), unit: 's' },
  ] });
}
