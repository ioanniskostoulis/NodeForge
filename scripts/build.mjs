// Builds everything into build/ with esbuild:
//   build/nfsim.cjs              command-line tool (Node)
//   build/app/                   the interface (browser / Electron renderer) and its worker, with
//                              public/ (page, styles, circuit library, menus), assets, license,
//                              notices, and the corresponding NodeForge source
//   build/desktop/main.cjs       Electron main process
//   build/desktop/preload.cjs    Electron preload script
// Pass --watch to rebuild on change.
import { copyFileSync } from "node:fs";
import { buildForgeApp } from "forge-shell/scripts/build";

const watch = process.argv.includes("--watch");
// Class names are used for XML tags of numbered element types (FuseElm → <Fuse>).
const buildOptions = { keepNames: true };

const buildTargets = [
  { ...buildOptions, entryPoints: ["source/cli/nfsim.ts"], outfile: "build/nfsim.cjs", platform: "node", format: "cjs" },
  { ...buildOptions, entryPoints: ["source/engine/index.ts"], outfile: "build/engine/index.cjs", platform: "node", format: "cjs" },
  { ...buildOptions, entryPoints: ["source/app/main.ts"], outfile: "build/app/app.js", platform: "browser", format: "esm" },
  { ...buildOptions, entryPoints: ["source/app/audio-worklet.ts"], outfile: "build/app/audio-worklet.js", platform: "browser", format: "esm" },
  { ...buildOptions, entryPoints: ["source/app/recommend-worker.ts"], outfile: "build/app/recommend-worker.js", platform: "browser", format: "iife" },
  { ...buildOptions, entryPoints: ["source/app/console-tools-worker.ts"], outfile: "build/app/console-tools-worker.js", platform: "browser", format: "iife" },
  { ...buildOptions, entryPoints: ["source/desktop/main.ts"], outfile: "build/desktop/main.cjs", platform: "node", format: "cjs", external: ["electron"] },
  { ...buildOptions, entryPoints: ["source/desktop/preload.ts"], outfile: "build/desktop/preload.cjs", platform: "node", format: "cjs", external: ["electron"] },
];

await buildForgeApp({
  targets: buildTargets,
  staticFiles: [
    ["assets/icon.png", "icon.png"],
    ["assets/logo.txt", "logo.txt"],
    ["assets/licenses/ngspice-modified-bsd.txt", "licenses/ngspice-modified-bsd.txt"],
    ["LICENSE", "LICENSE"],
    ["NOTICE.md", "NOTICE.md"],
    ["CHANGELOG.md", "CHANGELOG.md"],
  ],
  releaseDirs: ["source", "public", "assets", "scripts", "documentation"],
  releaseCopies: [{ from: "node_modules/forge-shell", to: "vendor/forge-shell" }],
  releaseFiles: ["LICENSE", "NOTICE.md", "README.md", "CHANGELOG.md", "VERSION", "forge.config.json", "package.json", "package-lock.json", "tsconfig.json"],
  watch,
});

// The generated licence texts also ship with the corresponding source.
copyFileSync("build/app/THIRD-PARTY-LICENSES.md", "build/app/release-source/THIRD-PARTY-LICENSES.md");
