import { NODE_WEBSOCKET_CODECS, NODE_WEBSOCKET_TRANSPORT, type ModuleInitializationV2, type NodeWebSocketProvider, type ServerTextConnection, type WebSocketCodecs } from '@space-sim/game-api';
import { acceptWebSocket } from './connection';

/** Protocol owner over borrowed native IO. The HTTP listener remains host-owned. */
export function createNodeWebSocketProvider(codecs: WebSocketCodecs): NodeWebSocketProvider {
  if (!codecs || typeof codecs.sha1Base64 !== 'function' || typeof codecs.deflate !== 'function' || typeof codecs.inflate !== 'function')
    throw new Error('Node WebSocket requires compatible native codecs');
  const connections = new Set<ServerTextConnection>(); let disposed = false;
  return {
    accept(request, stream, head, options) {
      if (disposed) throw new Error('Node WebSocket provider is disposed');
      const connection = acceptWebSocket(request, stream, head, Object.freeze({ ...options }), codecs);
      if (connection) { connections.add(connection); void connection.closed.then(() => connections.delete(connection)); }
      return connection;
    },
    dispose() {
      if (disposed) return; disposed = true;
      const errors: unknown[] = [];
      for (const connection of connections) { try { connection.close('Module disposed'); } catch (error) { errors.push(error); } }
      connections.clear(); if (errors.length) throw new AggregateError(errors, 'Node WebSocket cleanup failed');
    },
  };
}
/** Initialize the Node WebSocket server transport module, providing net.node-ws@1.0.0. */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Node WebSocket server transport',
    summary: 'Editable WebSocket protocol over a borrowed HTTP upgrade and native byte codecs.', asset: 'docs/creators/usage.json' });
  context.provide(NODE_WEBSOCKET_TRANSPORT, context.own(createNodeWebSocketProvider(context.use(NODE_WEBSOCKET_CODECS))));
}
