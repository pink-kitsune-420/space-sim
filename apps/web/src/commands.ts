import type { CommandExtension } from '../../../packages/game-api/src/index';
import { RESERVED_KEYS } from './input';

const keyName = (code: string): string => code.replace(/^(Key|Digit)/, '');

/** Reject a world whose module commands would take over this console's own controls,
 * before that world is activated. */
export function checkCommandKeys(commands: readonly CommandExtension[]): void {
  for (const command of commands) {
    const key = command.hook.key;
    if (key && RESERVED_KEYS.has(key)) throw new Error(`Module ${command.moduleId} command ${command.id}: key ${keyName(key)} is reserved by the flight console`);
  }
}

/** Buttons and key bindings for the active world's module commands. Requests go through the
 * session (the authoritative host checks and applies them); nothing here changes the world. */
export class CommandBar {
  private commands: readonly CommandExtension[] = [];
  constructor(private readonly container: HTMLElement, issue: (command: CommandExtension) => void) {
    container.addEventListener('click', event => {
      const id = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-command]')?.dataset.command;
      const command = this.commands.find(c => c.id === id);
      if (command) issue(command);
    });
  }
  /** Rebuild only when the world's command table changes. */
  sync(commands: readonly CommandExtension[]): void {
    if (commands === this.commands) return;
    this.commands = commands;
    this.container.replaceChildren(...commands.map(command => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.command = command.id;
      button.title = `${command.hook.label} · module command ${command.id}`;
      button.append(command.hook.label);
      if (command.hook.key) {
        const kbd = document.createElement('kbd');
        kbd.textContent = keyName(command.hook.key);
        button.append(' ', kbd);
      }
      return button;
    }));
    this.container.hidden = commands.length === 0;
  }
  set disabled(value: boolean) {
    for (const button of this.container.querySelectorAll('button')) button.disabled = value;
  }
  byKey(code: string): CommandExtension | undefined { return this.commands.find(c => c.hook.key === code); }
}
