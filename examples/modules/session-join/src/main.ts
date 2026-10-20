import { JOIN_PACKS, type JoinClientPort, type JoinNegotiation, type JoinPackFactory, type ModuleInitializationV2, type ServiceKey, type TextConnection } from '@space-sim/game-api';

export interface JoinNegotiatorHelper {
  negotiate(peer: TextConnection, port: JoinClientPort, signal?: AbortSignal): Promise<JoinNegotiation>;
}

export const JOIN_NEGOTIATOR: ServiceKey<JoinNegotiatorHelper> = Object.freeze({
  slot: 'example.join-pack-negotiator',
  version: '1.0.0',
});

export function createJoinNegotiatorHelper(factory: JoinPackFactory): JoinNegotiatorHelper {
  return Object.freeze({
    negotiate(peer: TextConnection, port: JoinClientPort, signal = new AbortController().signal): Promise<JoinNegotiation> {
      return factory.client(peer, port, signal);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(JOIN_PACKS);
  context.provide(JOIN_NEGOTIATOR, createJoinNegotiatorHelper(factory));
}
