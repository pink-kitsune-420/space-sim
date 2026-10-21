import {
  MANUAL_READER,
  type Disposable,
  type ManualService,
  type ManualAudience,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface GuidePublisher {
  /** Adds one game-owned guide (Creators by default). Dispose its lease to remove it. */
  publish(id: string, title: string, text: string, audience?: ManualAudience): Disposable;
}

export const GUIDE_PUBLISHER: ServiceKey<GuidePublisher> = Object.freeze({
  slot: 'example.manual',
  version: '1.0.0',
});

export function createGuidePublisher(manual: ManualService): GuidePublisher {
  return Object.freeze<GuidePublisher>({
    publish(id, title, text, audience = 'creators'): Disposable {
      return manual.register([{
        id,
        audience,
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
