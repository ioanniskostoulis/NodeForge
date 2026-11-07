// Menu shortcuts against the shell's tiers (forge-shell/app/shortcuts), on macOS and on Windows, with no exclusions:
// the standard items on their standard keys, Run and Reset on their named conventions, every other command on an App
// or Secondary key, no two commands on one key, no key the system takes and no key that types a character.
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { checkShortcuts } from "forge-shell/app/shortcuts"; export { MENU_COMMANDS, SHORTCUT_CONVENTIONS, isStandardAction } from "./source/app/commands";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error",
  define: { "import.meta.url": JSON.stringify("http://localhost/app.js") },
});
const { checkShortcuts, MENU_COMMANDS, SHORTCUT_CONVENTIONS, isStandardAction } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

const entries = MENU_COMMANDS.filter((command) => command.key).map((command) => ({
  id: command.id, key: command.key, owner: isStandardAction(command.id) ? "shell" : "app",
  ...(SHORTCUT_CONVENTIONS[command.id] ? { convention: SHORTCUT_CONVENTIONS[command.id] } : {}),
}));
for (const mac of [true, false]) assert.deepEqual(checkShortcuts(entries, mac), [], mac ? "macOS" : "Windows");
// the keys that moved out of the shell's Arrange keys and the text fields' Cmd+Right
const key = (id) => MENU_COMMANDS.find((command) => command.id === id).key;
assert.equal(key("edit.rotateCW"), "CmdOrCtrl+Shift+R");
assert.equal(key("edit.rotateCCW"), "CmdOrCtrl+Shift+L");
assert.equal(key("sim.step"), "CmdOrCtrl+Shift+T");
assert.equal(key("view.fit"), "CmdOrCtrl+0");
assert.equal(key("view.actualSize"), "CmdOrCtrl+1");
console.log(`Shortcuts: ${entries.length} menu keys pass the shell's checks on macOS and Windows, with no exclusions.`);
