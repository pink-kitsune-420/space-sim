import {
  MODULE_LOGS,
  type ModuleInitializationV2,
  type ModuleLogEntry,
  type ModuleLogService,
  type ServiceKey,
} from '@space-sim/game-api';

export interface AuditLog {
  /** Writes an `info` entry for this example module; filtered or invalid input is dropped silently. */
  note(event: string, message: string): void;
  /** Newest entries written by this example, oldest first. */
  recent(limit?: number): readonly ModuleLogEntry[];
}

export const AUDIT_LOG: ServiceKey<AuditLog> = Object.freeze({
  slot: 'example.logging',
  version: '1.0.0',
});

export function createAuditLog(logs: ModuleLogService, id: string, version: string): AuditLog {
  const logger = logs.logger({ id, version });
  return Object.freeze<AuditLog>({
    note(event, message): void {
      logger.write('info', event, message);
    },
    recent(limit = 10): readonly ModuleLogEntry[] {
      return logs.entries({ moduleId: id, limit });
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const logs = context.use(MODULE_LOGS);
  const module = context.module ?? { id: 'example.logging', version: '0.1.0' };
  context.provide(AUDIT_LOG, createAuditLog(logs, module.id, module.version));
}
