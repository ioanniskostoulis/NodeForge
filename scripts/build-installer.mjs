// Package the Windows desktop payload with the installer supplied by the pinned Forge shell.
let buildInstaller;
try {
  ({ buildInstaller } = await import("forge-shell/scripts/build-installer"));
} catch (error) {
  throw new Error("Forge setup requires a released forge-shell archive with the installer export (0.1.3 or later).", { cause: error });
}

const result = await buildInstaller({ stageOnly: process.argv.includes("--stage-only") });
console.log(`NodeForge setup staged: ${result.manifest.files.length} files, ${result.manifest.bytes} bytes.`);
