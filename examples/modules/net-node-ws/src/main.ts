import { NODE_WEBSOCKET_TRANSPORT, type HttpUpgrade, type ModuleInitializationV2,
  type NodeWebSocketProvider, type ServerTextConnection, type ServiceKey, type UpgradeByteStream } from '@space-sim/game-api';

export interface CustomNodeServerHelper {
  upgrade(request: HttpUpgrade, stream: UpgradeByteStream, head: Uint8Array, label?: string): ServerTextConnection | undefined;
}

export const CUSTOM_NODE_WS: ServiceKey<CustomNodeServerHelper> = Object.freeze({
  slot: 'example.node-ws-custom-server',
  version: '1.0.0',
});

export function createCustomNodeServerHelper(provider: NodeWebSocketProvider): CustomNodeServerHelper {
  return Object.freeze({
    upgrade(request: HttpUpgrade, stream: UpgradeByteStream, head: Uint8Array, label = 'custom-server'): ServerTextConnection | undefined {
      return provider.accept(request, stream, head, {
        label,
        maxMessageBytes: 65536,
        pingIntervalMs: 15000,
        deflate: false,
      });
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const provider = context.use(NODE_WEBSOCKET_TRANSPORT);
  context.provide(CUSTOM_NODE_WS, createCustomNodeServerHelper(provider));
}
