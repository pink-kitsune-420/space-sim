import '../../../modules/planet-designer/assets/designer.css';
import type { WorldRead } from '../../../packages/game-api/src/index';
import { coreRotationService } from '../../../packages/sim-core/src/module-services';
import { PlanetPreview } from '../../../packages/render-2d/src/index';
import { PlanetDesigner as PortableDesigner } from '../../../modules/planet-designer/src/designer';
import { downloadBlob } from './ui';
/** Default app adapter; storage/export permissions remain with the browser host. */
export class PlanetDesigner extends PortableDesigner {
 constructor(root: HTMLElement, world: () => WorldRead, current: () => string | undefined = () => undefined) {
  super({ rotation: coreRotationService, preview: canvas => new PlanetPreview(canvas) }, {
   root, world, current, storage: { getItem: key => localStorage.getItem(key), setItem: (key,value) => localStorage.setItem(key,value) },
   download: downloadBlob, confirm: text => confirm(text), copy: text => navigator.clipboard.writeText(text),
  });
 }
}
