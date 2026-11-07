// NodeForge's product identity and document wording for the shared shell.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import type { ForgeAppProfile } from "forge-shell/app/profile";
import config from "../../forge.config.json";

export const forgeApp = config satisfies ForgeAppProfile;
