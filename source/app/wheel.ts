// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { wheelIntent as sharedWheelIntent, type WheelIntent } from "forge-shell/app/wheel";
import { settings } from "./settings";

export type { WheelIntent } from "forge-shell/app/wheel";
export function wheelIntent(e: WheelEvent): WheelIntent {
  return sharedWheelIntent(e, settings.wheelZooms);
}
