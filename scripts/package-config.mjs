// Generate the desktop package configuration from the shared Forge defaults and this app's profile.
import { readFileSync, writeFileSync } from "node:fs";
import { electronBuilderConfig } from "forge-shell/scripts/package-config";
import { renderDmgBackground } from "forge-shell/scripts/dmg-background";

const config = JSON.parse(readFileSync("forge.config.json", "utf8"));
writeFileSync("build/electron-builder.json", `${JSON.stringify(electronBuilderConfig(config), null, 2)}\n`);
// The macOS disk image window is drawn from the profile; only a macOS package uses it.
if (process.platform === "darwin") renderDmgBackground();
