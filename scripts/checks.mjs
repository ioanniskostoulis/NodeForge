// Runs every check listed in documentation/DEVELOPMENT.md and compares each with the expected results in tests/checks.json:
// `npm run checks`. Needs ngspice on the PATH (the accuracy suites and models.json); the CircuitJS
// comparison needs the official recordings in tests/oracle/recordings (gitignored) and is skipped
// without them. `--only name,name` runs some checks, `--skip name,name` leaves some out.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";

const expected = JSON.parse(readFileSync("tests/checks.json", "utf8"));
const nfsim = "build/nfsim.cjs";

/** Run a command; resolves with its exit status, combined output and standard output alone. */
const run = (cmd, args) => new Promise((resolve) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", stdout = "";
  child.stdout.on("data", (d) => { out += d; stdout += d; });
  child.stderr.on("data", (d) => { out += d; });
  child.on("close", (status) => resolve({ status, out, stdout }));
  child.on("error", (err) => resolve({ status: -1, out: String(err), stdout }));
});
const node = (...args) => run(process.execPath, args);
const sameList = (a, b) => [...a].sort().join(" ") === [...b].sort().join(" ");
const tail = (out, n = 15) => out.trimEnd().split("\n").slice(-n).join("\n");

/** Run tasks with at most `n` at once, keeping their order in the results. */
async function pool(items, n, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await task(items[i]); }
  }));
  return results;
}

/** The accuracy limit (percent) for a circuit file. */
function accuracyLimit(file) {
  const { limits, default: fallback } = expected.accuracy;
  if (basename(file) in limits) return limits[basename(file)];
  const dir = `${file.slice(0, file.lastIndexOf("/"))}/*`;
  return dir in limits ? limits[dir] : fallback;
}

// Each check returns { ok, result, detail? }: result is a one-line summary, detail what went wrong.
const checks = {
  async typecheck() {
    const r = await run("npx", ["tsc", "--noEmit", "-p", "."]);
    return { ok: r.status === 0, result: r.status === 0 ? "no errors" : "errors", detail: tail(r.out) };
  },
  async build() {
    const r = await node("scripts/build.mjs");
    return { ok: r.status === 0, result: r.status === 0 ? "built" : "failed", detail: tail(r.out) };
  },
  async shell() {
    const r = await node("scripts/check-shell.mjs");
    return { ok: r.status === 0, result: r.status === 0 ? "built shell matches profile and package" : "shell mismatch", detail: tail(r.out) };
  },
  async upstream() {
    const r = await node(nfsim, "test", "tests/upstream-auto-tests");
    const m = r.out.match(/(\d+) passed, (\d+) failed/);
    const ok = r.status === 0 && m && +m[1] === expected.upstream.passed && +m[2] === 0;
    return { ok, result: m ? m[0] : "no summary", detail: tail(r.out) };
  },
  async oracle() {
    if (!existsSync("tests/oracle/recordings")) return { ok: true, skipped: true, result: "skipped (no CircuitJS recordings)" };
    const r = await run("sh", ["scripts/oracle-compare.sh", expected.oracle.list]);
    const cols = (text) => text.trim().split("\n").map((l) => l.split(/\s+/).slice(0, 3).join(" "));
    const want = cols(readFileSync(expected.oracle.expected, "utf8")), got = cols(r.out);
    const diff = [...want.filter((l) => !got.includes(l)).map((l) => `- ${l}`), ...got.filter((l) => !want.includes(l)).map((l) => `+ ${l}`)];
    const differ = got.filter((l) => l.split(" ")[1] === "DIFFER").length;
    return { ok: r.status === 0 && diff.length === 0, result: `${got.length} circuits, ${diff.length ? `${diff.length} lines changed` : `same as recorded (${differ} known DIFFER)`}`, detail: diff.join("\n") || tail(r.out) };
  },
  async bench() { return bench([], expected.bench); },
  async benchCircuitjs() { return bench(["--circuitjs"], expected.benchCircuitjs); },
  async roundtrip() {
    const r = await node(nfsim, "roundtrip", "public/circuits");
    const m = r.out.match(/(\d+) round-tripped, (\d+) failed/);
    const failed = [...r.out.matchAll(/^FAIL: (\S+)/gm)].map((x) => x[1]);
    const exitStatus = expected.roundtrip.failed.length ? 1 : 0;
    const ok = r.status === exitStatus && m && +m[1] === expected.roundtrip.roundTripped && sameList(failed, expected.roundtrip.failed);
    return { ok, result: m ? m[0] : "no summary", detail: `failed: ${failed.join(", ")}\nexpected: ${expected.roundtrip.failed.join(", ")}` };
  },
  async op() {
    const r = await node(nfsim, "bench", "public/circuits", "--op");
    const m = r.out.match(/newton: (\d+), FAILED: (\d+), gmin stepping: (\d+)/);
    const failed = [...r.out.matchAll(/^(\S+): FAILED/gm)].map((x) => x[1]);
    const ok = r.status === 0 && m && +m[1] === expected.op.newton && +m[3] === expected.op.gminStepping && sameList(failed, expected.op.failed);
    return { ok, result: m ? m[0] : "no summary", detail: `failed: ${failed.join(", ")}\nexpected: ${expected.op.failed.join(", ")}` };
  },
  async accuracy() {
    const files = [
      ...readdirSync("tests/accuracy").filter((f) => /\.(txt|xml)$/.test(f)).sort().map((f) => join("tests/accuracy", f)),
      ...readdirSync("tests/devices").filter((f) => f.endsWith(".xml")).sort().map((f) => join("tests/devices", f)),
    ];
    const rows = await pool(files, Math.max(1, availableParallelism() - 1), async (file) => {
      const r = await node(nfsim, "accuracy", file);
      const m = r.out.match(/worst shape error ([\d.]+)%/);
      const limit = accuracyLimit(file);
      const ok = r.status === 0 && m && +m[1] <= limit;
      return { ok, line: `${ok ? "ok  " : "FAIL"} ${file}: ${m ? `${m[1]}%` : r.out.trim().split("\n")[0]} (limit ${limit}%)` };
    });
    const worst = rows.filter((x) => !x.ok);
    return { ok: worst.length === 0, result: `${files.length} circuits, ${worst.length} over their limit`, detail: rows.map((x) => x.line).join("\n") };
  },
  async dcsweep() {
    const { limit, sweeps } = expected.dcsweep;
    const rows = await pool(sweeps, Math.max(1, availableParallelism() - 1), async ([file, ...sweep]) => {
      const r = await node(nfsim, "dcsweep", file, ...sweep.map(String));
      const m = r.out.match(/worst difference from ngspice ([\d.]+)%/);
      const ok = r.status === 0 && m && +m[1] <= limit && !/not found/.test(r.out);
      return { ok, line: `${ok ? "ok  " : "FAIL"} ${file}: ${m ? `${m[1]}%` : r.out.trim().split("\n")[0]} (limit ${limit}%)` };
    });
    const bad = rows.filter((x) => !x.ok);
    return { ok: bad.length === 0, result: `${sweeps.length} sweeps, ${bad.length} over ${limit}%`, detail: rows.map((x) => x.line).join("\n") };
  },
  async ac() {
    const { db, deg, sweeps } = expected.ac;
    const rows = await pool(sweeps, Math.max(1, availableParallelism() - 1), async ([file, ...sweep]) => {
      const r = await node(nfsim, "ac", file, ...sweep.map(String));
      const m = r.out.match(/worst ([\d.e+-]+) dB .*?, ([\d.e+-]+)° /);
      const ok = r.status === 0 && m && +m[1] <= db && +m[2] <= deg;
      return { ok, line: `${ok ? "ok  " : "FAIL"} ${file}: ${m ? `${m[1]} dB, ${m[2]}°` : r.out.trim().split("\n")[0]} (limits ${db} dB, ${deg}°)` };
    });
    const bad = rows.filter((x) => !x.ok);
    return { ok: bad.length === 0, result: `${sweeps.length} sweeps, ${bad.length} over ${db} dB / ${deg}°`, detail: rows.map((x) => x.line).join("\n") };
  },
  async models() {
    const r = await node(nfsim, "models", "assets/models/generic.lib", "--json", "--check");
    // the models and their checks, not the dates they were made on (a new day isn't a change)
    const undated = (text) => { try { return JSON.stringify(JSON.parse(text), (k, v) => (k === "added" || k === "date" ? undefined : v)); } catch { return null; } };
    const same = r.status === 0 && undated(r.stdout) !== null && undated(r.stdout) === undated(readFileSync("public/models.json", "utf8"));
    return { ok: same, result: same ? "public/models.json up to date" : "public/models.json differs from assets/models/generic.lib", detail: tail(r.out.replace(r.stdout, "")) };
  },
  async app() {
    const r = await node("scripts/test-app.mjs");
    const m = r.out.match(/(\d+) interface test files passed/);
    const ok = r.status === 0 && m && +m[1] === expected.app.files;
    return { ok, result: m ? m[0] : "failed", detail: tail(r.out, 30) };
  },
};

async function bench(flags, want) {
  const r = await node(nfsim, "bench", "public/circuits", ...flags);
  const m = r.out.match(/(\d+) circuits, (\d+) failed/);
  const ok = r.status === 0 && m && +m[1] === want.circuits && +m[2] === want.failed;
  return { ok, result: m ? m[0] : "no summary", detail: r.out.split("\n").filter((l) => /fail|error/i.test(l)).join("\n") };
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${name} needs a comma-separated list of check names.`);
    process.exit(2);
  }
  return value.split(",");
};
const only = arg("--only"), skip = arg("--skip") ?? [];
for (const n of [...(only ?? []), ...skip]) if (!(n in checks)) { console.error(`unknown check: ${n} (${Object.keys(checks).join(", ")})`); process.exit(2); }
const names = Object.keys(checks).filter((n) => (!only || only.includes(n) || n === "build") && !skip.includes(n));

let failed = 0;
for (const name of names) {
  const t0 = Date.now();
  const r = await checks[name]();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${r.skipped ? "skip" : r.ok ? "ok  " : "FAIL"} ${name.padEnd(15)} ${r.result}  [${secs} s]`);
  if (!r.ok) {
    failed++;
    if (r.detail) console.log(r.detail.replace(/^/gm, "     "));
    if (name === "build") break;
  } else if (name === "accuracy" && process.argv.includes("--verbose")) console.log(r.detail.replace(/^/gm, "     "));
}
console.log(failed ? `\n${failed} check${failed > 1 ? "s" : ""} failed.` : `\nAll ${names.length} checks passed.`);
process.exit(failed ? 1 : 0);
