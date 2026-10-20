import { CHAT_CONSOLES, type ChatConsole, type ChatConsoleFactory, type ChatConsoleOptions, type ChatMessageKind, type ModuleInitializationV2, type ServiceKey } from '@space-sim/game-api';

export interface ChatHelper {
  mount(options: ChatConsoleOptions): ChatConsole;
  logFormatted(console: ChatConsole, kind: ChatMessageKind, text: string, sender?: string): void;
}

export const CHAT_HELPER: ServiceKey<ChatHelper> = Object.freeze({
  slot: 'example.chat-history-formatter',
  version: '1.0.0',
});

export function createChatHelper(factory: ChatConsoleFactory): ChatHelper {
  return Object.freeze({
    mount(options: ChatConsoleOptions): ChatConsole {
      return factory.create(options);
    },
    logFormatted(console: ChatConsole, kind: ChatMessageKind, text: string, sender?: string): void {
      console.log(kind, text, sender);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(CHAT_CONSOLES);
  context.provide(CHAT_HELPER, createChatHelper(factory));
}
