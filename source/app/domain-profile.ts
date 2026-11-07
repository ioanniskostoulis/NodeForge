// NodeForge's domain catalogues and panes for the shared Forge shell.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import type { ForgeRuntimeProfile } from "forge-shell/app/profile";
import { CONSOLE_COMMANDS, MENU_COMMANDS } from "./commands";
import { SECTION_KEYS } from "./inspector";
import { buildMenus } from "./menus";
import { forgeApp } from "./profile";

const panes = ["terminal", "scopes", "messages"] as const;

export const nodeforgeRuntime = {
  config: forgeApp,
  menus: { build: buildMenus, commands: MENU_COMMANDS },
  commands: CONSOLE_COMMANDS,
  inspector: { sections: SECTION_KEYS },
  panes,
} satisfies ForgeRuntimeProfile<(typeof MENU_COMMANDS)[number], (typeof CONSOLE_COMMANDS)[number], typeof SECTION_KEYS[number], typeof panes[number], typeof buildMenus>;
