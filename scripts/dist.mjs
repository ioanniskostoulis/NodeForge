// Build the app package for this host; Windows wraps the unpacked app in the Forge setup.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cli = require.resolve("electron-builder/cli.js");
const windows = process.platform === "win32";
const args = [cli, ...(windows ? ["--win", "--x64", "--dir"] : []), "--publish", "never",
  "--config", "build/electron-builder.json", "--config.electronDist=./node_modules/electron/dist"];
const result = spawnSync(process.execPath, args, { stdio: "inherit" });
if (result.status !== 0) throw new Error(`Desktop package failed with exit code ${result.status}.`);
if (windows && !process.argv.includes("--unpacked-only")) {
  const installer = spawnSync(process.execPath, ["scripts/build-installer.mjs"], { stdio: "inherit" });
  if (installer.status !== 0) throw new Error(`Forge setup failed with exit code ${installer.status}.`);
}
