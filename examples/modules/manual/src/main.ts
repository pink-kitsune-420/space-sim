import {
  MANUAL_READER,
  type Disposable,
  type ManualService,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface GuidePublisher {
  /** Adds one Creators page. Dispose the lease to remove it again. */
  publish(id: string, title: string, text: string): Disposable;
}

export const GUIDE_PUBLISHER: ServiceKey<GuidePublisher> = Object.freeze({
  slot: 'example.manual',
  version: '1.0.0',
});

export function createGuidePublisher(manual: ManualService): GuidePublisher {
  return Object.freeze<GuidePublisher>({
    publish(id, title, text): Disposable {
      return manual.register([{
        id,
        audience: 'creators',
        title,
        summary: title,
        document: { blocks: [{ type: 'paragraph', text }] },
      }]);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(GUIDE_PUBLISHER, createGuidePublisher(context.use(MANUAL_READER)));
}
