import { WEBSOCKET_TRANSPORT, type ModuleInitializationV2, type ServiceKey, type TransportProvider } from '@space-sim/game-api';

export interface WebSocketEchoClient {
  readonly address: string;
  readonly messages: readonly string[];
  send(text: string): void;
  close(reason?: string): void;
}

export interface WebSocketClientHelper {
  connect(address: string, signal: AbortSignal): Promise<WebSocketEchoClient>;
}

export const WEBSOCKET_CLIENT: ServiceKey<WebSocketClientHelper> = Object.freeze({
  slot: 'example.websocket-custom-client',
  version: '1.0.0',
});

export function createWebSocketClientHelper(transport: TransportProvider): WebSocketClientHelper {
  return Object.freeze({
    async connect(address: string, signal: AbortSignal): Promise<WebSocketEchoClient> {
      const peer = await transport.connect(address, signal);
      const received: string[] = [];
      peer.onmessage = text => { received.push(text); };
      return {
        address,
        get messages() { return received; },
        send(text: string) { peer.send(text); },
        close(reason?: string) { peer.close(reason); },
      };
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const transport = context.use(WEBSOCKET_TRANSPORT);
  context.provide(WEBSOCKET_CLIENT, createWebSocketClientHelper(transport));
}
