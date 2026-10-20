import type { CommandExtension, CommandModalContext } from '../../../packages/game-api/src/index';
import { RESERVED_KEYS } from './input';

const keyName = (code: string): string => code.replace(/^(Key|Digit)/, '');

const EVA_RESERVED_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']);
const EDITOR_RESERVED_KEYS = new Set(['KeyZ', 'KeyY']);

/** Reject a world whose module commands would take over this console's own controls,
 * before that world is activated. */
export function checkCommandKeys(commands: readonly CommandExtension[]): void {
  for (const command of commands) {
    const key = command.hook.key;
    if (!key) continue;
    const context = command.hook.context ?? 'flight';
    if (context === 'flight' || context === 'all') {
      if (RESERVED_KEYS.has(key)) throw new Error(`Module ${command.moduleId} command ${command.id}: key ${keyName(key)} is reserved by the flight console`);
    } else if (context === 'eva') {
      if (EVA_RESERVED_KEYS.has(key)) throw new Error(`Module ${command.moduleId} command ${command.id}: key ${keyName(key)} is reserved by the flight console`);
    } else if (context === 'editor') {
      if (EDITOR_RESERVED_KEYS.has(key)) throw new Error(`Module ${command.moduleId} command ${command.id}: key ${keyName(key)} is reserved by the flight console`);
    }
  }
}

/** Buttons and key bindings for the active world's module commands. Requests go through the
 * session (the authoritative host checks and applies them); nothing here changes the world. */
export class CommandBar {
  private commands: readonly CommandExtension[] = [];
  private readonly renderedKeys = new Map<string, string | undefined>();
  private mode: CommandModalContext = 'flight';

  constructor(
    private readonly container: HTMLElement,
    issue: (command: CommandExtension) => void,
    private keysFor?: (id: string) => readonly string[] | undefined,
  ) {
    container.addEventListener('click', event => {
      const id = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-command]')?.dataset.command;
      const command = this.commands.find(c => c.id === id);
      if (command && this.isCommandActive(command)) issue(command);
    });
  }

  setMode(mode: CommandModalContext | 'landed' | 'flying'): void {
    const nextMode: CommandModalContext = (mode === 'landed' || mode === 'flying') ? 'flight' : (mode as CommandModalContext);
    if (this.mode === nextMode) return;
    this.mode = nextMode;
    this.updateVisibility();
  }

  getMode(): CommandModalContext {
    return this.mode;
  }

  isCommandActive(command: CommandExtension, mode: CommandModalContext = this.mode): boolean {
    const ctx = command.hook.context ?? 'flight';
    return ctx === 'all' || ctx === mode;
  }

  private updateVisibility(): void {
    let visibleCount = 0;
    for (const button of this.container.querySelectorAll<HTMLButtonElement>('button[data-command]')) {
      const id = button.dataset.command;
      const command = this.commands.find(c => c.id === id);
      const active = command ? this.isCommandActive(command) : false;
      button.hidden = !active;
      if (active) visibleCount++;
    }
    this.container.hidden = visibleCount === 0;
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
      button.hidden = !this.isCommandActive(command);
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
    this.updateVisibility();
  }
  set disabled(value: boolean) {
    for (const button of this.container.querySelectorAll('button')) button.disabled = value;
  }
  byKey(code: string, mode?: CommandModalContext): CommandExtension | undefined {
    const activeMode = mode ?? this.mode;
    return this.commands.find(c => this.commandKeys(c).includes(code) && this.isCommandActive(c, activeMode));
  }
}
