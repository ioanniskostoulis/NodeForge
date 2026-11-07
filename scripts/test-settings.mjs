// App preferences survive a new page load and remain local to their storage origin.
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({ entryPoints: ["source/app/settings.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
const url = "data:text/javascript;base64," + Buffer.from(outputFiles[0].text).toString("base64");
const storage = (entries = new Map()) => ({
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => { entries.set(key, value); },
});

globalThis.document = {};
globalThis.localStorage = storage();
const first = await import(url + "#first");
assert.equal(first.settings.appearance, "dark");
assert.equal(first.settings.propertiesExpanded, true);
first.updateSettings({ appearance: "light", propertiesExpanded: false, adjustExpanded: true, sliderConfigExpanded: true });
const second = await import(url + "#second");
assert.equal(second.settings.appearance, "light");
assert.equal(second.settings.propertiesExpanded, false);
assert.equal(second.settings.adjustExpanded, true);
assert.equal(second.settings.sliderConfigExpanded, true);

globalThis.localStorage = storage();
const otherOrigin = await import(url + "#other-origin");
assert.equal(otherOrigin.settings.appearance, "dark");
assert.equal(otherOrigin.settings.propertiesExpanded, true);

// a missing or invalid value takes its default, a removed key is dropped and the sizes are clamped
const { restoreSettings, DEFAULTS } = await import(url + "#restore");
const restored = restoreSettings({ appearance: "sepia", inspectorWidth: 9999, terminalFontSize: "big", bottomPanelHeight: 50, removedKey: 1, euroResistors: true, solver: "accurate", showInspector: false });
assert.equal(restored.appearance, DEFAULTS.appearance);
assert.equal(restored.inspectorWidth, 420);
assert.equal(restored.terminalFontSize, DEFAULTS.terminalFontSize);
assert.equal(restored.bottomPanelHeight, 246); // never below the default size
assert.equal("removedKey" in restored, false);
assert.equal(restored.symbolStyle, "iec");
assert.equal(restored.solver, "nodeforge");
assert.equal(restored.showInspector, false);
console.log("App preferences persist per origin and restore on reload.");
