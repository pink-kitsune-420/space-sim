import type { PresentationCommandSender, SessionRead } from '../../../packages/game-api/src/index';

/** Bind a presentation input capability to an explicit seat and ship. The local session
 * can operate other local seats, so ownership must be checked before calling it.
 * isCurrent revokes the capability on frame, selection, world or session replacement. */
export function presentationCommands(session: SessionRead, playerId: string, shipId: string,
  isCurrent: () => boolean): PresentationCommandSender {
  const world = session.world;
  return Object.freeze({
    issue(commandId: string, args?: Readonly<Record<string, number>>): boolean {
      if (!isCurrent() || session.world !== world || session.paused || world.record(shipId)?.ownerId !== playerId) return false;
      try { session.command(shipId, commandId, args); return true; }
      catch { return false; } // Host refusal is already diagnosed through the session.
    },
  });
}
