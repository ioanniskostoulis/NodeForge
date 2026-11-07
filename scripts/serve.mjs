// NodeForge's preview adapter: component gallery circuits are served from tests/components.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startServer as startForgeServer } from "forge-shell/scripts/serve";

export function startServer(options = {}) {
  return startForgeServer({
    ...options,
    resolveFile: (path) => path.startsWith("/circuits/_components/")
      ? join("tests/components", path.slice("/circuits/_components/".length)) : null,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
