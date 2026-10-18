/** Native primitives only. Protocol ownership lives in the editable Node transport module. */
import { createHash } from 'node:crypto';
import { constants, deflateRawSync, inflateRawSync } from 'node:zlib';
import type { HttpUpgrade, ServerSocketOptions, UpgradeByteStream, WebSocketCodecs } from '../../../packages/game-api/src/index';
import { acceptWebSocket as accept } from '../../../modules/net-node-ws/src/connection';
export type { ServerSocketOptions as SocketOptions } from '../../../packages/game-api/src/index';
export { ServerWebSocket } from '../../../modules/net-node-ws/src/connection';
export const nativeWebSocketCodecs: WebSocketCodecs = Object.freeze({
  sha1Base64: (text: string) => createHash('sha1').update(text).digest('base64'),
  deflate: (bytes: Uint8Array) => deflateRawSync(bytes, { level: 1, finishFlush: constants.Z_SYNC_FLUSH }),
  inflate: (bytes: Uint8Array, maximumBytes: number) => inflateRawSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: maximumBytes }),
});
export function acceptWebSocket(request: HttpUpgrade, stream: UpgradeByteStream, head: Uint8Array, options: ServerSocketOptions) {
  return accept(request, stream, head, options, nativeWebSocketCodecs);
}
