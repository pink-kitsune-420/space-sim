/** Legacy Space Sim channel/wire adapter. Generic games use the scoped factory. */
import type { TextConnection, TabChannel, TabLocks } from '@space-sim/game-api';
import { LocalDiscovery as Discovery, LocalHost as Host, connectLocal as connect, type LocalOptions as Options, type LocalAdvert } from './connection';
export const LOCAL_CHANNEL = 'space-sim-local';
export type ChannelLike = TabChannel;
export type LocksLike = TabLocks;
export type LocalOptions = Omit<Options, 'channelName'>;
export type { LocalAdvert } from './connection';
export class LocalHost extends Host {
  constructor(describe: () => Omit<LocalAdvert, 'host'>, accept: (peer: TextConnection) => void, options: LocalOptions = {}) {
    super(describe, accept, { ...options, channelName: LOCAL_CHANNEL });
  }
}
export class LocalDiscovery extends Discovery {
  constructor(change: (worlds: readonly LocalAdvert[]) => void, options: LocalOptions = {}) { super(change, { ...options, channelName: LOCAL_CHANNEL }); }
}
export function connectLocal(host: string, options: LocalOptions = {}): Promise<TextConnection> {
  return connect(host, { ...options, channelName: LOCAL_CHANNEL });
}
