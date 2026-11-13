// The welcome screen keeps every menu item and disables the ones that need a circuit.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { buildMenus, availableWithoutDocument } from "./source/app/menus";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error",
  define: { "import.meta.url": JSON.stringify("http://localhost/app.js") },
});
const { buildMenus, availableWithoutDocument } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const draw = JSON.parse(readFileSync("public/drawmenu.json", "utf8"));
const library = { root: [], titles: new Map() };
const items = (menus) => menus.flatMap((m) => (m.submenu ? items(m.submenu) : m.id ? [m] : []));
const state = { canUndo: true, canRedo: true, hasSelection: true, tool: null, recent: ["/circuits/zvs.nfg", "/lab/zvs.nfg"] };

const welcome = items(buildMenus(draw, library, true, { ...state, hasDocument: false }));
const open = items(buildMenus(draw, library, true, { ...state, hasDocument: true }));
assert.equal(welcome.length, open.length, "no item is removed on the welcome screen");
for (const item of welcome) {
  assert.equal(item.enabled === false, !availableWithoutDocument(item.id), `${item.id} on the welcome screen`);
}
const byId = (list, id) => list.find((item) => item.id === id);
for (const id of ["file.new", "file.open", "file.recent.0", "file.recent.clear", "file.autosave.off", "view.inspector", "appearance.dark", "app.settings", "about.licenses"]) assert.notEqual(byId(welcome, id).enabled, false, id);
for (const id of ["file.save", "file.close", "edit.undo", "edit.cut", "sim.toggle", "scopes.stack", "tab.next"]) assert.equal(byId(welcome, id).enabled, false, id);
assert.ok(welcome.filter((item) => item.id.startsWith("tool:")).every((item) => item.enabled === false), "part tools");
assert.notEqual(byId(open, "file.save").enabled, false);
assert.equal(byId(open, "edit.undo").enabled, true);
// two recent files with one name are told apart by their folder
assert.deepEqual(welcome.filter((item) => /^file\.recent\.\d$/.test(item.id)).map((item) => item.label), ["zvs.nfg — circuits", "zvs.nfg — lab"]);
console.log("Welcome menu: document-only items are disabled and none is missing.");
