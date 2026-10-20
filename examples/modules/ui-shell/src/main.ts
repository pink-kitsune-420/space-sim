import {
  WINDOW_SHELL,
  type ModuleInitializationV2,
  type ServiceKey,
  type WindowShell,
  type WindowShellFactory,
} from '@space-sim/game-api';

export interface SinglePanelShellHelper {
  /** One group with one panel. The shell borrows `content`; disposing the shell restores it. */
  create(viewport: HTMLElement, content: HTMLElement, release: () => void, focus: () => void): WindowShell;
}

export const SINGLE_PANEL_SHELL: ServiceKey<SinglePanelShellHelper> = Object.freeze({
  slot: 'example.ui-shell',
  version: '1.0.0',
});

export function createSinglePanelShellHelper(factory: WindowShellFactory): SinglePanelShellHelper {
  return Object.freeze<SinglePanelShellHelper>({
    create(viewport, content, release, focus): WindowShell {
      return factory.create({
        viewport,
        groups: [[{ id: 'notes', title: 'Notes', label: 'Notes', icon: 'manual', hint: 'Open notes', content: [content] }]],
        release,
        focus,
      });
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(SINGLE_PANEL_SHELL, createSinglePanelShellHelper(context.use(WINDOW_SHELL)));
}
