import {
  WINDOWS,
  type ModuleInitializationV2,
  type ServiceKey,
  type WindowChrome,
  type WindowSystem,
} from '@space-sim/game-api';

export interface NoticeWindowHelper {
  /** Creates a closed, movable window. The caller disposes it when finished. */
  create(container: HTMLElement, id: string, title: string): WindowChrome;
}

export const NOTICE_WINDOWS: ServiceKey<NoticeWindowHelper> = Object.freeze({
  slot: 'example.ui-windows',
  version: '1.0.0',
});

export function createNoticeWindowHelper(windows: WindowSystem): NoticeWindowHelper {
  return Object.freeze<NoticeWindowHelper>({
    create(container, id, title): WindowChrome {
      return windows.create({ id, title, icon: 'manual', container });
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(NOTICE_WINDOWS, createNoticeWindowHelper(context.use(WINDOWS)));
}
