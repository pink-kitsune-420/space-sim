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
  private readonly renderedKeys = new Map<string, string | undefined>();
  constructor(
    private readonly container: HTMLElement,
    issue: (command: CommandExtension) => void,
    private keysFor?: (id: string) => readonly string[] | undefined,
  ) {
    container.addEventListener('click', event => {
      const id = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-command]')?.dataset.command;
      const command = this.commands.find(c => c.id === id);
      if (command) issue(command);
    });
  }
  commandKeys(command: CommandExtension): readonly string[] {
    const configured = this.keysFor?.(command.id);
    if (configured !== undefined && configured.length > 0) return configured;
    return command.hook.key ? [command.hook.key] : [];
  }
  /** Rebuild when the world's command table changes or remapping occurs. */
  sync(commands: readonly CommandExtension[], keysFor?: (id: string) => readonly string[] | undefined): void {
    if (keysFor) this.keysFor = keysFor;
    const sameCommands = commands === this.commands || (commands.length === this.commands.length && commands.every((c, i) => c === this.commands[i]));
    if (sameCommands) {
      let keysChanged = false;
      for (const cmd of commands) {
        if (this.renderedKeys.get(cmd.id) !== this.commandKeys(cmd)[0]) {
          keysChanged = true;
          break;
        }
      }
      if (!keysChanged) return;
    }
    this.commands = commands;
    this.renderedKeys.clear();
    this.container.replaceChildren(...commands.map(command => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.command = command.id;
      button.title = `${command.hook.label} · module command ${command.id}`;
      button.append(command.hook.label);
      const key = this.commandKeys(command)[0];
      this.renderedKeys.set(command.id, key);
      if (key) {
        const kbd = document.createElement('kbd');
        kbd.textContent = keyName(key);
        button.append(' ', kbd);
      }
      return button;
    }));
    this.container.hidden = commands.length === 0;
  }
  set disabled(value: boolean) {
    for (const button of this.container.querySelectorAll('button')) button.disabled = value;
  }
  byKey(code: string): CommandExtension | undefined {
    return this.commands.find(c => this.commandKeys(c).includes(code));
  }
}
