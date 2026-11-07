// Verify the built NodeForge page uses the installed shared shell.
import { checkForgeApp } from "forge-shell/scripts/check-app";

const result = checkForgeApp();
console.log(`${result.product} built shell: profile, page slots, styles and renderer match.`);
