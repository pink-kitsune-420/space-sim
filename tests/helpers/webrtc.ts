export class Channel extends EventTarget {
  readyState = 'open';
  bufferedAmount = 0;
  sent: string[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(text: string): void { this.sent.push(new TextDecoder().decode(new TextEncoder().encode(text))); }
  close(): void { this.readyState = 'closed'; }
}
export class Peer extends EventTarget {
  static all: Peer[] = [];
  static gathering: 'complete' | 'gathering' = 'complete';
  static offerFails = false;
  iceGatheringState = Peer.gathering;
  connectionState = 'new';
  signalingState = 'stable';
  channel = new Channel();
  localDescription?: { type: string; sdp: string; toJSON(): unknown };
  ondatachannel: ((event: { channel: Channel }) => void) | null = null;
  constructor(readonly configuration?: RTCConfiguration) { super(); Peer.all.push(this); }
  createDataChannel(): Channel { return this.channel; }
  async createOffer() { if (Peer.offerFails) throw new Error('Offer failed'); return { type: 'offer', sdp: 'v=0\r\n' }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\n' }; }
  async setLocalDescription(value: { type: string; sdp: string }) {
    this.localDescription = { ...value, toJSON() { return { type: this.type, sdp: this.sdp }; } };
  }
  async setRemoteDescription() {}
  close(): void { this.signalingState = 'closed'; this.connectionState = 'closed'; this.dispatchEvent(new Event('connectionstatechange')); }
}
export const code = (kind: 'offer' | 'answer') => `${kind === 'offer' ? 'SSO1' : 'SSA1'}.r${Buffer.from(JSON.stringify({ t: kind, s: 'v=0\r\n' })).toString('base64url')}`;

