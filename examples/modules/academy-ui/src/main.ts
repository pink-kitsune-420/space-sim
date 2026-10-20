import {
  ACADEMY_PANELS,
  type AcademyPanel,
  type AcademyPanelFactory,
  type AcademyPanelOptions,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface AcademyUiHelper {
  /** Mounts an Orbital Academy panel over explicit host window, shell and flight adapters. */
  mount(options: AcademyPanelOptions): AcademyPanel;
}

export const ACADEMY_UI_HELPER: ServiceKey<AcademyUiHelper> = Object.freeze({
  slot: 'example.academy-ui',
  version: '1.0.0',
});

export function createAcademyUiHelper(panels: AcademyPanelFactory): AcademyUiHelper {
  return Object.freeze<AcademyUiHelper>({
    mount(options): AcademyPanel {
      return panels.create(options);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(ACADEMY_UI_HELPER, createAcademyUiHelper(context.use(ACADEMY_PANELS)));
}
