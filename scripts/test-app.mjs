// Runs every interface test (pure logic of source/app): `npm run test:app`.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("build/tests", { recursive: true });
await build({ entryPoints: ["tests/inspector-menu-canvas.ts"], bundle: true, platform: "node", format: "cjs", keepNames: true,
  define: { "import.meta.url": JSON.stringify("http://localhost/app.js") }, outfile: "build/tests/inspector-menu-canvas.cjs", logLevel: "error" });
await build({ entryPoints: ["tests/part-placement.ts"], bundle: true, platform: "node", format: "cjs", outfile: "build/tests/part-placement.cjs", logLevel: "error" });
await build({ entryPoints: ["tests/placement-drawing.ts"], bundle: true, platform: "node", format: "cjs", keepNames: true,
  define: { "import.meta.url": JSON.stringify("http://localhost/app.js") }, outfile: "build/tests/placement-drawing.cjs", logLevel: "error" });
await build({ entryPoints: ["tests/label-layout.ts"], bundle: true, platform: "node", format: "cjs", outfile: "build/tests/label-layout.cjs", logLevel: "error" });
await build({ entryPoints: ["tests/display-options.ts"], bundle: true, platform: "node", format: "cjs", keepNames: true,
  define: { "import.meta.url": JSON.stringify("http://localhost/app.js") }, outfile: "build/tests/display-options.cjs", logLevel: "error" });
await build({ entryPoints: ["node_modules/forge-shell/tests/conformance/documents.ts"], bundle: true, platform: "node", format: "cjs",
  outfile: "build/tests/forge-documents.cjs", logLevel: "error" });

const runs = [
  ["--test", "build/tests/inspector-menu-canvas.cjs"],
  ["scripts/test-settings.mjs"],
  ["scripts/test-console.mjs"],
  ["scripts/test-current-flow.mjs"],
  ["tests/scope-layout.mjs"],
  ["tests/wire-jumps.mjs"],
  ["tests/audio-capture.mjs"],
  ["tests/scope-math.mjs"],
  ["tests/scope-nav.mjs"],
  ["tests/scope-measure.mjs"],
  ["tests/scope-expr.mjs"],
  ["tests/power.mjs"],
  ["tests/resonance.mjs"],
  ["tests/part-issues.mjs"],
  ["tests/dc-sweep.mjs"],
  ["tests/param-sweep.mjs"],
  ["tests/ac-sweep.mjs"],
  ["tests/console-set.mjs"],
  ["tests/undo.mjs"],
  ["tests/nfg-format.mjs"],
  ["tests/messages.mjs"],
  ["tests/welcome-menu.mjs"],
  ["tests/shortcuts.mjs"],
  ["tests/command-syntax.mjs"],
  ["--test", "build/tests/part-placement.cjs"],
  ["--test", "build/tests/placement-drawing.cjs"],
  ["--test", "build/tests/display-options.cjs"],
  ["--test", "build/tests/label-layout.cjs"],
  ["--test", "build/tests/forge-documents.cjs"],
];
let failed = 0;
for (const args of runs) {
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.error(`FAILED: node ${args.join(" ")}`); }
}
if (failed) process.exit(1);
console.log(`${runs.length} interface test files passed.`);
