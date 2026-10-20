import {
  MOD_MENU,
  type ModMenuModulePort,
  type ModMenuModuleView,
  type ModMenuService,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface ModulePickerHelper {
  /** Mounts the exact-release module picker into `root`. The caller disposes the view. */
  mount(root: HTMLElement, port: ModMenuModulePort): ModMenuModuleView;
}

export const MODULE_PICKER: ServiceKey<ModulePickerHelper> = Object.freeze({
  slot: 'example.mod-menu',
  version: '1.0.0',
});

export function createModulePickerHelper(menu: ModMenuService): ModulePickerHelper {
  return Object.freeze<ModulePickerHelper>({
    mount(root, port): ModMenuModuleView {
      return menu.modules(root, port, { title: 'Example modules' });
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(MODULE_PICKER, createModulePickerHelper(context.use(MOD_MENU)));
}
