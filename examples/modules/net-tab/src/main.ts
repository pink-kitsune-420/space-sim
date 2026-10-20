import { TAB_TRANSPORT, type ModuleInitializationV2, type ServiceKey,
  type TabChannel, type TabNetwork, type TabNetworkFactory } from '@space-sim/game-api';

export interface TabBridgeHelper {
  createScopedNetwork(scope: string, protocolId: string, channelFactory?: (name: string) => TabChannel): TabNetwork;
}

export const TAB_BRIDGE: ServiceKey<TabBridgeHelper> = Object.freeze({
  slot: 'example.tab-channel-bridge',
  version: '1.0.0',
});

export function createTabBridgeHelper(factory: TabNetworkFactory): TabBridgeHelper {
  return Object.freeze({
    createScopedNetwork(scope: string, protocolId: string, channelFactory?: (name: string) => TabChannel): TabNetwork {
      return factory.create({
        scope,
        protocolId,
        channel: channelFactory,
        locks: null, // Test-friendly: bypasses navigator.locks
        beatMs: 1000,
        timeoutMs: 5000,
        connectTimeoutMs: 2000,
      });
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(TAB_TRANSPORT);
  context.provide(TAB_BRIDGE, createTabBridgeHelper(factory));
}
