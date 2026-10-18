import initialize from './main';
import type { ModuleInitialization } from '@space-sim/game-api';
export default function entry(context: ModuleInitialization): void {
  initialize({ ...context, assets: { ...context.assets, "color.txt": context.assets["assets/color.txt"]! } });
}
