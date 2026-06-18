import type { AppSettings } from "../../shared/ipc-contracts";

export type LoginStartupAdapter = {
  setLoginItemSettings: (settings: { openAtLogin: boolean }) => void;
};

export function applyLoginStartupSetting(settings: AppSettings, adapter: LoginStartupAdapter): void {
  adapter.setLoginItemSettings({ openAtLogin: settings.tray.openAtLogin });
}
