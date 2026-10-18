/** Default-game composition; shared chrome lives in its editable package. */
import type { WindowChromeOptions } from '../../../packages/game-api/src/index';
import { FloatingWindow as SharedWindow } from '../../../modules/ui-windows/src/window';
import { applyHudThemeToDom, getActiveTheme } from '../../../packages/render-2d/src/theme';
export type FloatingWindowOptions = Omit<WindowChromeOptions, 'storage' | 'decorate' | 'dismissOn'>;
export class FloatingWindow extends SharedWindow {
  constructor(options: FloatingWindowOptions) {
    super({...options, storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},
      decorate: panel=>applyHudThemeToDom(getActiveTheme(),panel),
      dismissOn: target=>target instanceof HTMLCanvasElement && (target.id==='flight-view'||target.id==='orbit-canvas')});
  }
}
