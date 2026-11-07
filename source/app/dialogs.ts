// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { askToApply as askToApplyChanges, askToSaveAll as askToSaveAllDocuments } from "forge-shell/app/dialogs";
import type { UnsavedChoice } from "forge-shell/app/dialogs";
import { forgeApp } from "./profile";
export { askToSave } from "forge-shell/app/dialogs";
export type { SaveChoice, UnsavedChoice } from "forge-shell/app/dialogs";

export function askToSaveAll(circuits: { name: string; path: string | null }[]): Promise<UnsavedChoice> {
  return askToSaveAllDocuments(circuits, forgeApp.document.plural);
}

/** Recommended simulation settings: what was found, the changes (current, recommended), Apply or Cancel. */
export function askToApply(title: string, findings: string[], changes: [string, string, string][]): Promise<boolean> {
  return askToApplyChanges(title, findings, changes, ["Setting", "Current", "Recommended"]);
}
