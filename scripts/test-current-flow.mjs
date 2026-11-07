import { build } from "esbuild";
import { execFileSync } from "node:child_process";

await build({ entryPoints: ["tests/current-flow.ts"], bundle: true, platform: "node", format: "cjs", outfile: "build/tests/current-flow.cjs" });
execFileSync(process.execPath, ["build/tests/current-flow.cjs"], { stdio: "inherit" });
