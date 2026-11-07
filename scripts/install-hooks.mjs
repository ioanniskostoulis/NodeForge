// Install the local Git hook used by GitHub Desktop and command-line commits.
import { installVersionHook } from "forge-shell/scripts/version-hook";

installVersionHook({ marker: "# NodeForge automatic patch version hook" });
