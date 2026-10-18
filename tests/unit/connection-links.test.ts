import { expect, it } from 'vitest';
import { connectionRequest, inviteFromText, inviteLink, serverLink } from '../../apps/web/src/connection-links';

it('keeps shared browser invites in the fragment and accepts pasted links', () => {
  const link = inviteLink('https://game.example/play/?game=space-sim', 'SSO1.rabc')!;
  expect(new URL(link).searchParams.has('invite')).toBe(false);
  expect(connectionRequest(new URL(link).hash)).toEqual({ invite: 'SSO1.rabc', join: false });
  expect(inviteFromText(link)).toBe('SSO1.rabc');
  expect(inviteFromText(' SSO1.rabc ')).toBe('SSO1.rabc');
  expect(inviteLink('file:///tmp/game.html', 'SSO1.rabc')).toBeUndefined();
});

it('shares dedicated-server page URLs with explicit join intent and no secrets', () => {
  expect(serverLink('192.168.1.20:6464')).toBe('http://192.168.1.20:6464/#join=1');
  expect(serverLink('wss://play.example/ws')).toBe('https://play.example/#join=1');
  expect(serverLink('https://play.example/game/ws')).toBe('https://play.example/game/#join=1');
  expect(() => serverLink('wss://user:secret@play.example/ws')).toThrow('password field');
  expect(connectionRequest('#join=1')).toEqual({ join: true });
  expect(connectionRequest('#app').join).toBe(false);
});
