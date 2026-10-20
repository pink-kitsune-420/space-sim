import {
  ALARM_PANELS,
  type AlarmPanel,
  type AlarmPanelFactory,
  type AlarmPanelOptions,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface AlarmPanelHelper {
  createPanel(options: AlarmPanelOptions): AlarmPanel;
  updatePanel(panel: AlarmPanel): void;
}

export const ALARM_PANEL_HELPER: ServiceKey<AlarmPanelHelper> = Object.freeze({
  slot: 'example.alarm-panel',
  version: '1.0.0',
});

export function createAlarmPanelHelper(factory: AlarmPanelFactory): AlarmPanelHelper {
  return Object.freeze({
    createPanel(options: AlarmPanelOptions): AlarmPanel {
      return factory.create(options);
    },
    updatePanel(panel: AlarmPanel): void {
      panel.update();
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(ALARM_PANELS);
  context.provide(ALARM_PANEL_HELPER, createAlarmPanelHelper(factory));
}
