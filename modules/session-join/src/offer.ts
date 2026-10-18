import { sha256Bytes } from './sha256';
import type { JoinOffer, JoinPackageRequirement } from '@space-sim/game-api';
export const MAX_PACK = 32 * 1024 * 1024;
export const MAX_TEXT = 96 * 1024;
export const CHUNK = 48 * 1024;
export const digest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
export function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid prejoin record');
  return raw as Record<string, unknown>;
}
export function parse(text: string): Record<string, unknown> {
  if (text.length > MAX_TEXT) throw new Error('Prejoin message exceeds 96 KiB');
  return record(JSON.parse(text));
}
export function validateOffer(raw: unknown): JoinOffer {
  const value = record(raw);
  const fields = ['format', 'id', 'sessionId', 'name', 'protocol', 'entitySchema', 'model', 'fingerprint', 'lockDigest', 'packDigest', 'packBytes', 'packages'];
  if (Object.keys(value).length !== fields.length || fields.some(key => !(key in value)) || value.format !== 'spacelab-join-offer/1'
    || !digest(value.id) || !text(value.sessionId, 128) || !text(value.name, 256) || !text(value.protocol, 128) || !text(value.entitySchema, 128)
    || !text(value.model, 128) || !digest(value.fingerprint) || !digest(value.lockDigest) || !digest(value.packDigest)
    || !count(value.packBytes, MAX_PACK) || value.packBytes === 0 || !Array.isArray(value.packages) || value.packages.length > 256) throw new Error('Unsupported or invalid game-pack offer');
  const seen = new Set<string>();
  const packages = value.packages.map(raw => {
    const requirement = record(raw), fields = ['id', 'version', 'digest', 'bytes', 'license', 'containsCode', 'sourceIncluded', 'required', 'tier'];
    if (Object.keys(requirement).length !== fields.length || fields.some(key => !(key in requirement))
      || !text(requirement.id, 192) || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(requirement.id) || seen.has(requirement.id)
      || !text(requirement.version, 128) || !digest(requirement.digest) || !count(requirement.bytes, MAX_PACK)
      || !text(requirement.license, 256) || typeof requirement.containsCode !== 'boolean' || typeof requirement.sourceIncluded !== 'boolean'
      || typeof requirement.required !== 'boolean' || !['authoritative', 'presentation', 'platform', 'network'].includes(requirement.tier as string)) throw new Error('Invalid game-pack inventory');
    seen.add(requirement.id); return Object.freeze({ ...requirement }) as unknown as JoinPackageRequirement;
  });
  const result = Object.freeze({ ...value, packages: Object.freeze(packages) }) as unknown as JoinOffer;
  if (offerIdentity(result) !== result.id) throw new Error('Game-pack offer identity mismatch');
  return result;
}
export function base64(bytes: Uint8Array): string {
  let binary = ''; for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary);
}
export function unbase64(text: string): Uint8Array {
  if (text.length > CHUNK * 4 / 3 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Invalid game-pack chunk');
  const binary = atob(text); if (binary.length > CHUNK) throw new Error('Oversized game-pack chunk');
  return Uint8Array.from(binary, value => value.charCodeAt(0));
}

/** Stable offer identity covers metadata as well as content and authority. */
export function offerIdentity(value: Omit<JoinOffer, 'format' | 'id'>): string {
  const packages = [...value.packages].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(item => ({
    id: item.id, version: item.version, digest: item.digest, bytes: item.bytes, license: item.license,
    containsCode: item.containsCode, sourceIncluded: item.sourceIncluded, required: item.required, tier: item.tier,
  }));
  return sha256Bytes(new TextEncoder().encode(JSON.stringify({ sessionId: value.sessionId, name: value.name,
    protocol: value.protocol, entitySchema: value.entitySchema, model: value.model, fingerprint: value.fingerprint,
    lockDigest: value.lockDigest, packDigest: value.packDigest, packBytes: value.packBytes, packages })));
}
export function createOffer(value: Omit<JoinOffer, 'format' | 'id'>): JoinOffer {
  return validateOffer({ ...value, format: 'spacelab-join-offer/1', id: offerIdentity(value) });
}
