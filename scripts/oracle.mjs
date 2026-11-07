// NodeForge — differential testing against the official CircuitJS1 build.
//
// Serves an official CircuitJS1 web build (the GWT-compiled `war` folder) with a recorder script
// injected. Open the printed URL in a browser: the page loads each queued circuit through
// CircuitJS1's JS interface, records every element's post voltages at each timestep, and posts the
// recording back here, where it's saved as JSON for `nfsim compare <circuit> <recording>`.
//
//   node scripts/oracle.mjs [--steps N] [--every K] [--head H] [--list paths.txt] <circuit.txt>...
//
// Every K-th timestep is recorded, plus each of the first H (to find where a divergence starts).
//
// CIRCUITJS_WAR overrides the build location (default: the macOS CircuitJS1 app's bundled copy).
// Recordings go to tests/oracle/recordings/<circuit name>.json.
//
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { basename, extname, join, normalize, resolve } from "node:path";

const WAR = process.env.CIRCUITJS_WAR ?? "/Applications/CircuitJS1.app/Contents/Resources/app/war";
let port = Number(process.env.PORT ?? 5180);
const recordingsDir = resolve("tests/oracle/recordings");

const args = process.argv.slice(2);
let steps = 20000, every = 1, head = 0;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--steps") steps = Number(args[++i]);
  else if (args[i] === "--every") every = Number(args[++i]);
  else if (args[i] === "--head") head = Number(args[++i]);
  else if (args[i] === "--port") port = Number(args[++i]);
  // a file with one circuit path per line
  else if (args[i] === "--list") files.push(...readFileSync(args[++i], "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => resolve(l)));
  else files.push(resolve(args[i]));
}
if (!existsSync(join(WAR, "circuitjs.html"))) {
  console.error(`no CircuitJS1 build at ${WAR} (set CIRCUITJS_WAR)`);
  process.exit(1);
}
mkdirSync(recordingsDir, { recursive: true });

const jobs = files.map((f) => ({ name: basename(f, extname(f)), text: readFileSync(f, "utf8"), steps, every, head }));

// Runs inside the CircuitJS page. Speeds the simulation up (the speed setting doesn't change
// results), then records post voltages after every `every`-th timestep.
const client = `
(function () {
  async function next(api) {
    const job = await (await fetch("/oracle/job")).json();
    if (!job) { document.title = "oracle: done"; console.log("oracle: done"); return; }
    // speed slider value (iterCount) is the 4th field of the options line
    const text = job.text.replace(/^\\$ (\\S+) (\\S+) (\\S+)/m, "$ $1 $2 400");
    api.setSimRunning(false);
    api.ontimestep = null;
    api.importCircuit(text, false);
    const elms = api.getElements();
    // post counts are taken after the first step: analysis can change them (bus widths)
    const rec = { name: job.name, every: job.every, elements: null, samples: [] };
    let n = 0;
    api.ontimestep = () => {
      n++;
      if (n === 1) rec.elements = elms.map((e) => ({ type: e.getType(), posts: e.getPostCount() }));
      if (n <= job.head || n % job.every === 0) {
        const v = [];
        for (const e of elms) for (let p = 0; p < e.getPostCount(); p++) v.push(e.getVoltage(p));
        rec.samples.push({ n, t: api.getTime(), v });
      }
      if (n >= job.steps) {
        api.ontimestep = null;
        api.setSimRunning(false);
        document.title = "oracle: saving " + job.name;
        fetch("/oracle/result", { method: "POST", body: JSON.stringify(rec) }).then(() => next(api));
      }
    };
    document.title = "oracle: running " + job.name;
    api.setSimRunning(true);
  }
  window.oncircuitjsloaded = (api) => setTimeout(() => next(api), 500);
})();
`;

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain", ".png": "image/png", ".gif": "image/gif", ".json": "application/json" };

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/oracle/job") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(jobs.shift() ?? null));
    return;
  }
  if (url.pathname === "/oracle/result" && req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const name = JSON.parse(body).name;
      const path = join(recordingsDir, `${name}.json`);
      writeFileSync(path, body);
      console.log(`oracle: wrote ${path} (${Math.round(body.length / 1024)} KB)`);
      res.end("ok");
      if (jobs.length === 0) console.log("oracle: all jobs recorded");
    });
    return;
  }
  // static files from the CircuitJS build; the page gets the recorder injected
  let path = url.pathname === "/" ? "/circuitjs.html" : decodeURIComponent(url.pathname);
  const full = normalize(join(WAR, path));
  if (!full.startsWith(WAR) || !existsSync(full) || statSync(full).isDirectory()) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("content-type", types[extname(full)] ?? "application/octet-stream");
  if (path === "/circuitjs.html") {
    res.end(readFileSync(full, "utf8").replace("</body>", `<script>${client}</script></body>`));
    return;
  }
  res.end(readFileSync(full));
}).listen(port, () => {
  console.log(`oracle: ${jobs.length} circuit(s), ${steps} steps, sampling every ${every}`);
  console.log(`oracle: open http://localhost:${port}/`);
});
