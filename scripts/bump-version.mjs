// Increment the patch version in the commit being created.
// Git runs this from the repository root through scripts/install-hooks.mjs.
import { bumpPatchVersion } from "forge-shell/scripts/version-hook";

bumpPatchVersion({ requiredHookFiles: ["scripts/bump-version.mjs", "scripts/install-hooks.mjs"] });
