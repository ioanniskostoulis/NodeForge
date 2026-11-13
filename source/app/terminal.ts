// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { TerminalPanel as SharedTerminalPanel } from "forge-shell/app/terminal";
import type { ConsoleHost } from "forge-shell/app/terminal";
import { terminalHistoryStorageKey } from "forge-shell/app/profile";
import type { TerminalPreferences } from "forge-shell/app/terminal-preferences";
import { onSettingsChange, settings, updateSettings } from "./settings";
import { forgeApp } from "./profile";

export type { ConsoleListItem, ConsoleTable, ConsoleResult, ConsoleHost } from "forge-shell/app/terminal";

export class TerminalPanel extends SharedTerminalPanel {
  constructor(host: HTMLElement, logo: string, version: string, commands: ConsoleHost, preferences: TerminalPreferences) {
    super(host, logo, version, commands, {
      appName: forgeApp.identity.name,
      tagline: forgeApp.identity.purpose,
      historyStorageKey: terminalHistoryStorageKey(forgeApp),
      fontSize: () => settings.terminalFontSize,
      setFontSize: (size) => updateSettings({ terminalFontSize: size }),
      onFontSizeChange: onSettingsChange,
      preferences,
    });
  }
}
