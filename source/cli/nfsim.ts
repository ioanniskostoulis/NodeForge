// nfsim: headless command-line runner for the simulation engine (Node).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Circuit, isLossless, PlaceholderElm, runRegression, Simulator, toSpice, visiblePlots, writeNfg, writeText, writeXml } from "../engine";
import { accuracy, acCompare, dcSweep, operatingPoint, relativeError } from "./accuracy";
import { bench } from "./bench";
import { MEASURE_UNITS, MEASURES, monteCarlo, spread } from "./monte-carlo";
import { si } from "../app/format";
import { MAX_SPEED_RATIO, MIN_SPEED_RATIO, SimulationModel } from "../app/model";
import { analyzeCircuit } from "../app/recommend";
import { findModels, KIND_LABELS, type LibraryModel } from "../app/model-catalog";
import { checkModel } from "./model-check";

/** Print a message and stop with an error. */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function usage(): never {
  console.log(`usage:
  nfsim test <file|dir>...      replay upstream regression data embedded in circuit files
  nfsim info <file|dir>...      list element support, sliders and scopes for circuit files
  nfsim run <file> [seconds]    simulate and print each element's voltage drop and current
  nfsim roundtrip <file|dir>... save each circuit as text and XML, reload, and check nothing changed
  nfsim compare <file> <rec>    compare against a recording from official CircuitJS1 (scripts/oracle.mjs)
  nfsim spice <file>            print the circuit as an ngspice netlist
  nfsim xml <file>              print the circuit in the XML format
  nfsim nfg <file>              print the circuit as a NodeForge .nfg file
  nfsim models <spice file>... [--check] [--name N]
                                the part models in a SPICE file (as the library imports them);
                                --check runs each in NodeForge and ngspice and compares
  nfsim op <file>...            find the DC operating point and compare it with ngspice's .op
  nfsim ac <file> <source> <fstart> <fstop> [points per decade]
                                small-signal analysis with AC 1 on a source, compared with ngspice's .ac
  nfsim dcsweep <file> <source> <start> <stop> <step>
                                sweep a source's DC value (1: the circuit's first independent
                                source) and compare every node with ngspice's .dc
  nfsim analyze <file>... [--circuitjs] [--reltol r]
                                the background analysis (Recommend Settings): what the circuit
                                does, settings for it, what made the solver work, and confidence
  nfsim montecarlo <file> [--runs n] [--seed s] [--time s] [--probe R1]... [--csv out.csv]
                                run with the parts varied within their tolerances (a seed per run)
                                and report how each probed part's voltage spreads
  nfsim bench <file|dir>... [--circuitjs] [--reltol r] [--steps n] [--top n] [--dense] [--diag]
                                run circuits and report failures (non-convergence etc.) and time;
                                --circuitjs runs them in CircuitJS mode instead of on NodeForge's engine;
                                --top lists the slowest (LU: pivot orders / refactored / reused);
                                --diag shows which parts set the step size or block convergence
  nfsim accuracy <file>... [--time s] [--step s] [--circuitjs] [--reltol r]
                                compare node voltages against ngspice (the reference); --circuitjs
                                runs in CircuitJS mode instead of on NodeForge's engine`);
  process.exit(2);
}

function circuitFiles(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (statSync(p).isDirectory()) {
      out.push(...readdirSync(p).filter((f) => /\.(txt|xml|nfg)$/.test(f) && f !== "setuplist.txt").sort().map((f) => join(p, f)));
    } else {
      out.push(p);
    }
  }
  return out;
}

/**
 * Which engine a command runs: NodeForge's unless `--circuitjs` asks for CircuitJS mode.
 * (`--accurate`, the NodeForge engine's flag before it was the default, is still accepted.)
 */
function engineFlag(args: string[]): boolean {
  let nodeforge = true;
  for (const [flag, value] of [["--circuitjs", false], ["--accurate", true]] as const) {
    const i = args.indexOf(flag);
    if (i < 0) continue;
    args.splice(i, 1);
    if (!value) nodeforge = false;
  }
  return nodeforge;
}

const load = (path: string) => Circuit.parse(readFileSync(path, "utf8"));
/** A circuit file's max time step. */
const c0 = (path: string) => load(path).options.maxTimeStep;
const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "bench": {
    const take = (name: string) => {
      const i = args.indexOf(name);
      return i < 0 ? undefined : Number(args.splice(i, 2)[1]);
    };
    const relTol = take("--reltol"), steps = take("--steps") ?? 4000;
    const accurate = engineFlag(args);
    const di = args.indexOf("--dense");
    const dense = di >= 0;
    if (dense) args.splice(di, 1);
    const oi = args.indexOf("--op");
    if (oi >= 0) {
      // operating points only: which method found each one
      args.splice(oi, 1);
      const vi = args.indexOf("--verbose");
      const verbose = vi >= 0;
      if (verbose) args.splice(vi, 1);
      const methods = new Map<string, number>();
      for (const f of circuitFiles(args)) {
        const c = load(f);
        const sim = new Simulator();
        sim.maxTimeStep = sim.timeStep = c.options.maxTimeStep;
        sim.accurate = true;
        if (dense) sim.sparse = false;
        if (verbose) sim.log = (m) => console.log(`  ${m}`);
        sim.useCircuitOptions(c.options);
        sim.setElements(c.simulatedElements);
        sim.resetTime();
        const t0 = performance.now();
        let method: string;
        try {
          method = sim.solveOperatingPoint() ?? "FAILED";
        } catch (e) {
          method = `exception: ${(e as Error).message}`;
        }
        const ms = performance.now() - t0;
        methods.set(method.startsWith("exception") ? "exception" : method, (methods.get(method.startsWith("exception") ? "exception" : method) ?? 0) + 1);
        if (method !== "newton") console.log(`${basename(f)}: ${method} (${ms.toFixed(0)} ms)`);
      }
      console.log([...methods].map(([m, n]) => `${m}: ${n}`).join(", "));
      break;
    }
    const top = take("--top") ?? 0;
    const gi = args.indexOf("--diag");
    const diag = gi >= 0;
    if (diag) args.splice(gi, 1);

    let failed = 0, slow = 0, total = 0;
    const files = circuitFiles(args);
    const results = [];
    for (const f of files) {
      const r = bench(f, { accurate, dense, relTol, steps, limitMs: 10000 });
      results.push(r);
      total += r.ms;
      const d = r.diagnostics;
      if (diag && d) {
        // what made the solver work: steps against what the max step alone needs, and by part
        const plain = d.span / (c0(f) || 1);
        console.log(`${r.file}: ${d.steps} steps (${(d.steps / Math.max(1, plain)).toFixed(1)}× the max step's), ${d.rejected} taken back, shortest ${si(d.minStep, "s", true)}${d.loose ? `, ${d.loose} loose` : ""}`);
        const worst = d.parts.filter((p) => p.stats.limited + p.stats.rejected + p.stats.blocked + p.stats.loose > 0)
          .sort((a, b) => b.stats.limited + b.stats.blocked - (a.stats.limited + a.stats.blocked)).slice(0, 5);
        for (const p of worst) {
          const s = p.stats;
          console.log(`  ${p.name.padEnd(10)} limited ${String(s.limited).padStart(6)}  ringing ${String(s.ringing).padStart(6)}  rejected ${String(s.rejected).padStart(5)}  blocked ${String(s.blocked).padStart(5)}  loose ${String(s.loose).padStart(4)}`);
        }
      }
      if (r.failure) {
        failed++;
        console.log(`FAIL ${r.file} at ${(r.reached * 100).toFixed(0)}%: ${r.failure}`);
      } else if (r.ms > 3000) {
        slow++;
        console.log(`SLOW ${r.file}: ${(r.ms / 1000).toFixed(1)} s for ${(r.reached * 100).toFixed(0)}% (${r.steps} steps)`);
      }
    }
    if (top) {
      // the slowest circuits, with their largest matrix
      for (const r of results.sort((a, b) => b.ms - a.ms).slice(0, top)) {
        const lu = accurate && !dense ? `  LU ${r.lu.analyzed}/${r.lu.refactored}/${r.lu.reused}` : "";
        console.log(`${r.ms.toFixed(0).padStart(7)} ms  ${String(r.steps).padStart(7)} steps  ${String(r.size).padStart(4)} rows  ${r.file}${lu}`);
      }
    }
    console.log(`${accurate ? `nodeforge (reltol ${relTol ?? "default"})` : "circuitjs"}: ${files.length} circuits, ${failed} failed, ${slow} slow, ${(total / 1000).toFixed(1)} s`);
    break;
  }
  case "models": {
    // the models in a SPICE file (as the library would import them), optionally checked against ngspice
    const ci = args.indexOf("--check");
    const check = ci >= 0;
    if (check) args.splice(ci, 1);
    const ni = args.indexOf("--name");
    const only = ni >= 0 ? args.splice(ni, 2)[1].toLowerCase() : null;
    const ji = args.indexOf("--json");
    if (ji >= 0) {
      // library entries (with checks when asked), as the app's models.json
      args.splice(ji, 1);
      const out: LibraryModel[] = [];
      for (const f of args) {
        for (const m of findModels(readFileSync(f, "utf8")).models) {
          if (only && m.name.toLowerCase() !== only) continue;
          if (check) {
            const r = checkModel(m);
            m.check = { error: r.error === null ? null : +r.error.toPrecision(3), date: new Date().toISOString().slice(0, 10), note: r.note };
          }
          out.push(m);
        }
      }
      process.stdout.write(JSON.stringify(out, null, 1) + "\n");
      break;
    }
    if (!args[0]) usage();
    for (const f of args) {
      const { models, skipped } = findModels(readFileSync(f, "utf8"), basename(f));
      console.log(`${basename(f)}: ${models.length} part model${models.length === 1 ? "" : "s"}${skipped.length ? ` (${skipped.length} line${skipped.length === 1 ? "" : "s"} not understood)` : ""}`);
      for (const m of models) {
        if (only && m.name.toLowerCase() !== only) continue;
        const specs = Object.entries(m.specs).map(([k, v]) => `${k} ${v}`).join(", ");
        let line = `  ${m.name.padEnd(16)} ${KIND_LABELS[m.kind].padEnd(17)} ${m.manufacturer ? m.manufacturer + "; " : ""}${specs}`;
        if (check) {
          const r = checkModel(m);
          line += `\n${" ".repeat(19)}→ ${r.error === null ? "not checked" : `matches ngspice within ${r.error.toFixed(3)}%`}${r.note ? ` ${r.note}` : ""}`;
        }
        console.log(line);
      }
    }
    break;
  }
  case "check-models": {
    // for the app: models (a JSON array of library entries) checked against ngspice, as JSON
    if (!args[0]) usage();
    const models = JSON.parse(readFileSync(args[0], "utf8")) as LibraryModel[];
    const results = models.map((m) => {
      try {
        return { name: m.name, ...checkModel(m) };
      } catch (err) {
        return { name: m.name, error: null, note: (err as Error).message };
      }
    });
    process.stdout.write(JSON.stringify(results));
    break;
  }
  case "xml": {
    // a circuit in the XML format (NodeForge's extensions included)
    if (!args[0]) usage();
    const c = load(args[0]);
    if (!isLossless(c, "xml")) fail(`${args[0]}: has parts the XML format can't keep (CircuitJS text only)`);
    process.stdout.write(writeXml(c));
    break;
  }
  case "nfg": {
    // a circuit as a NodeForge .nfg file
    if (!args[0]) usage();
    const c = load(args[0]);
    if (!isLossless(c, "nfg")) fail(`${args[0]}: has parts the .nfg format can't keep (CircuitJS text only)`);
    process.stdout.write(writeNfg(c));
    break;
  }
  case "analyze": {
    // the app's background analysis (Recommend Settings), on a file
    const ci = args.indexOf("--circuitjs");
    const accurate = ci < 0;
    if (!accurate) args.splice(ci, 1);
    const ri = args.indexOf("--reltol");
    const relTol = ri >= 0 ? Number(args.splice(ri, 2)[1]) : 1e-5;
    if (!args.length) usage();
    for (const f of args) {
      const m = new SimulationModel(readFileSync(f, "utf8"));
      const t = m.tolerance;
      const t0 = performance.now();
      const rec = analyzeCircuit({
        text: m.serialize(m.circuit.format).text,
        names: m.circuit.elements.map((e, i) => m.designator(e) ?? `#${i}`),
        tolerance: t.enabled ? { seed: t.seed, perElement: m.circuit.elements.map((e) => (e.tolerance ? { ...e.tolerance } : null)) } : null,
        timeStep: m.sim.maxTimeStep,
        sourceFrequency: m.fastestSource()?.frequency ?? 0,
        accurate, relTol,
        minSpeed: MIN_SPEED_RATIO, maxSpeed: MAX_SPEED_RATIO,
      });
      console.log(`${basename(f)} (${((performance.now() - t0) / 1000).toFixed(1)} s):`);
      for (const line of rec.findings) console.log(`  ${line}`);
      console.log(`  → time step ${si(rec.timeStep, "s", true)}, speed ${si(rec.speedRatio, "s", true)}/s${rec.relTol !== null ? `, accuracy ${+(rec.relTol * 100).toPrecision(2)}%` : ""}`);
    }
    break;
  }
  case "montecarlo":
  case "monte-carlo": {
    const take = (name: string) => {
      const i = args.indexOf(name);
      return i < 0 ? undefined : args.splice(i, 2)[1];
    };
    const runs = Number(take("--runs") ?? 50), seed = Number(take("--seed") ?? 1);
    const time = take("--time");
    const timeArg = time !== undefined ? Number(time) : undefined;
    const probes: string[] = [];
    for (let p = take("--probe"); p !== undefined; p = take("--probe")) probes.push(p);
    const csv = take("--csv");
    if (!args[0]) usage();
    const r = monteCarlo(readFileSync(args[0], "utf8"), {
      runs, seed, probes, seconds: timeArg,
      progress: (done, total) => process.stderr.write(`\r${done}/${total} runs`),
    });
    process.stderr.write("\n");
    if (r.missing.length) console.log(`not in the circuit: ${r.missing.join(", ")}`);
    const stopped = r.runs.filter((x) => x.stopped);
    console.log(`${basename(args[0])}: ${r.runs.length} runs (seeds ${seed}–${seed + runs - 1}), ${si(r.seconds, "s", true)} each${stopped.length ? `; ${stopped.length} stopped early (seeds ${stopped.map((x) => x.seed).join(", ")})` : ""}`);
    const fmt = (v: number, u: string) => (Number.isFinite(v) ? si(v, u, true, 4) : "–");
    r.probes.forEach((probe, j) => {
      // a part whose voltage is the same steady value in every run: one line
      const all = [r.nominal[j], ...r.runs.map((x) => x.measures[j])];
      if (all.every((m) => m.pp === 0 && m.mean === all[0].mean)) {
        console.log(`\n${probe}: ${fmt(all[0].mean, "V")} in every run`);
        return;
      }
      console.log(`\n${probe} (voltage across it, settled second half)`);
      console.log(`  ${"".padEnd(6)} ${"ideal".padStart(12)} ${"mean".padStart(12)} ${"σ".padStart(11)} ${"min (seed)".padStart(20)} ${"max (seed)".padStart(20)}`);
      for (const key of MEASURES) {
        const u = MEASURE_UNITS[key], sp = spread(r, j, key);
        // no rows for what doesn't apply (no oscillation: no frequency or start-up)
        if (!sp || (key === "freq" && sp.max.v === 0 && !r.nominal[j].freq)) continue;
        console.log(`  ${key.padEnd(6)} ${fmt(r.nominal[j][key], u).padStart(12)} ${fmt(sp.mean, u).padStart(12)} ${fmt(sp.sd, u).padStart(11)} ${`${fmt(sp.min.v, u)} (${sp.min.seed})`.padStart(20)} ${`${fmt(sp.max.v, u)} (${sp.max.seed})`.padStart(20)}`);
      }
    });
    if (csv) {
      const header = ["seed", ...r.probes.flatMap((p) => MEASURES.map((k) => `${p}.${k}`))];
      const rows = [["ideal", ...r.nominal.flatMap((m) => MEASURES.map((k) => m[k]))], ...r.runs.map((x) => [x.seed, ...x.measures.flatMap((m) => MEASURES.map((k) => m[k]))])];
      writeFileSync(csv, [header, ...rows].map((row) => row.join(",")).join("\n") + "\n");
      console.log(`\nper-run results: ${csv}`);
    }
    break;
  }
  case "ac": {
    const [file, which, f0, f1, per] = args;
    if (!f1) usage();
    const r = acCompare(readFileSync(file, "utf8"), Number(which), Number(f0), Number(f1), Number(per ?? 10));
    const name = basename(file);
    if (r.unsupported.length) console.log(`${name}: skipped (no SPICE equivalent yet: ${r.unsupported.join(", ")})`);
    else if (r.error) console.log(`${name}: ${r.error}`);
    else {
      const worst = r.nodes.reduce((a, b) => (b.db > a.db ? b : a), r.nodes[0]);
      const worstDeg = r.nodes.reduce((a, b) => (b.deg > a.deg ? b : a), r.nodes[0]);
      console.log(`${name}: AC 1 on ${r.source}, ${f0} to ${f1} Hz (${r.freqs.length} points) — worst ${worst ? worst.db.toPrecision(3) : "–"} dB (node ${worst?.node ?? "–"}), ${worstDeg ? worstDeg.deg.toPrecision(3) : "–"}° (node ${worstDeg?.node ?? "–"}) from ngspice`);
      for (const e of r.nodes) console.log(`  ${e.node.padEnd(6)} ${e.db.toPrecision(3).padStart(10)} dB ${e.deg.toPrecision(3).padStart(10)}°`);
    }
    break;
  }
  case "dcsweep": {
    const [file, which, start, stop, step] = args;
    if (!step) usage();
    const r = dcSweep(readFileSync(file, "utf8"), Number(which), Number(start), Number(stop), Number(step));
    const name = basename(file);
    if (r.unsupported.length) console.log(`${name}: skipped (no SPICE equivalent yet: ${r.unsupported.join(", ")})`);
    else if (r.error) console.log(`${name}: ${r.error}`);
    else {
      const scale = Math.max(...r.nodes.map((e) => e.swing), 1e-9);
      const rel = (e: { max: number; swing: number }) => (e.max / Math.max(e.swing, scale * 0.1)) * 100;
      const worst = r.nodes.reduce((a, b) => (rel(b) > rel(a) ? b : a), r.nodes[0]);
      console.log(`${name}: ${r.source} from ${start} to ${stop} by ${step} (${r.values.length} points${r.failed.length ? `, ${r.failed.length} not found` : ""}) — worst difference from ngspice ${worst ? rel(worst).toFixed(4) : "–"}% (node ${worst?.node ?? "–"})`);
      for (const e of r.nodes) console.log(`  ${e.node.padEnd(6)} ${e.max.toPrecision(3).padStart(10)} V of ${e.swing.toPrecision(3).padStart(8)} V  ${rel(e).toFixed(4).padStart(8)}%`);
    }
    break;
  }
  case "op": {
    for (const file of circuitFiles(args)) {
      const r = operatingPoint(readFileSync(file, "utf8"));
      const name = basename(file);
      if (r.unsupported.length) {
        console.log(`${name}: skipped (no SPICE equivalent yet: ${r.unsupported.join(", ")})`);
        continue;
      }
      if (r.error) {
        console.log(`${name}: ${r.error}${r.method ? ` (NodeForge: ${r.method})` : ""}`);
        continue;
      }
      const worst = Math.max(...r.nodes.map((n) => Math.abs(n.ours - n.ref)));
      console.log(`${name}: ${r.method}, largest difference from ngspice ${worst.toPrecision(3)} V`);
      for (const n of r.nodes) console.log(`  ${n.node.padEnd(6)} ours ${n.ours.toPrecision(8).padStart(14)}   ngspice ${n.ref.toPrecision(8).padStart(14)}   diff ${Math.abs(n.ours - n.ref).toExponential(2)}`);
    }
    break;
  }
  case "spice": {
    if (!args[0]) usage();
    const net = toSpice(load(args[0]));
    console.log(net.text);
    if (net.unsupported.length) console.error(`not exported: ${net.unsupported.join(", ")}`);
    break;
  }
  case "accuracy": {
    const flag = (name: string) => {
      const i = args.indexOf(name);
      if (i < 0) return undefined;
      const v = Number(args.splice(i, 2)[1]);
      return Number.isFinite(v) ? v : usage();
    };
    const seconds = flag("--time"), step = flag("--step"), relTol = flag("--reltol");
    const accurate = engineFlag(args);
    for (const file of circuitFiles(args)) {
      const r = accuracy(readFileSync(file, "utf8"), { seconds, step, accurate, relTol });
      const name = basename(file);
      if (r.unsupported.length) {
        console.log(`${name}: skipped (no SPICE equivalent yet: ${r.unsupported.join(", ")})`);
        continue;
      }
      if (r.referenceTol === null) {
        console.log(`${name}: no reference (ngspice: ${r.error})`);
        continue;
      }
      // errors relative to the node's swing (or to the circuit's largest swing for a node that barely moves)
      const rel = relativeError(r);
      const worst = r.nodes.reduce((a, b) => (rel(b.shape, b) > rel(a.shape, a) ? b : a), r.nodes[0]);
      console.log(`${name}: step ${+r.step.toPrecision(6)} s, ${r.steps} steps over ${+r.seconds.toPrecision(6)} s — worst shape error ${rel(worst.shape, worst).toFixed(3)}% (node ${worst.node})${r.referenceTol !== 1e-6 || r.referenceMethod !== "gear" ? ` [reference: ${r.referenceMethod} at reltol ${r.referenceTol}]` : ""}${r.stopped ? `  [stopped: ${r.stopped}]` : ""}`);
      console.log("  node        raw max      shape        rms      swing   raw %   shape %");
      for (const e of r.nodes) {
        console.log(`  ${e.node.padEnd(6)} ${e.max.toPrecision(3).padStart(10)} ${e.shape.toPrecision(3).padStart(10)} ${e.rms.toPrecision(3).padStart(10)} ${e.swing.toPrecision(3).padStart(10)} ${rel(e.max, e).toFixed(3).padStart(7)} ${rel(e.shape, e).toFixed(3).padStart(9)}`);
      }
    }
    break;
  }
  case "test": {
    let pass = 0, fail = 0, skip = 0;
    for (const file of circuitFiles(args)) {
      const name = basename(file);
      try {
        const start = performance.now();
        const r = runRegression(load(file), name);
        const ms = Math.round(performance.now() - start);
        const head = { pass: "PASS", fail: "FAIL", skip: "SKIP" }[r.status];
        const extra = r.status === "skip" ? "" : `  [${ms} ms, max rel. error ${r.maxRelativeError.toExponential(2)}]`;
        console.log(`${head}: ${name}${extra}`);
        for (const d of r.details) console.log(`    ${d}`);
        if (r.status === "pass") pass++;
        else if (r.status === "fail") fail++;
        else skip++;
      } catch (err) {
        console.log(`FAIL: ${name}\n    load error: ${(err as Error).message}`);
        fail++;
      }
    }
    console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exit(fail > 0 ? 1 : 0);
  }

  case "info": {
    const files = circuitFiles(args);
    const totals = new Map<string, number>();
    let supported = 0;
    for (const file of files) {
      let c: Circuit;
      try {
        c = load(file);
      } catch (err) {
        console.log(`${basename(file)}: load error: ${(err as Error).message}`);
        continue;
      }
      if (c.isFullySupported) supported++;
      for (const [k, v] of c.unsupportedTypes) totals.set(k, (totals.get(k) ?? 0) + v);
      if (files.length === 1) {
        console.log(`${c.elements.length} elements; unported: ${JSON.stringify(Object.fromEntries(c.unsupportedTypes))}`);
        for (const a of c.adjustables) {
          console.log(`slider '${a.label}': elm ${a.elementIndex} item ${a.editItem} [${a.minValue} … ${a.maxValue}]${a.logarithmic ? " log" : ""}`);
        }
        c.scopes.forEach((s, i) => {
          console.log(`scope ${i}: speed ${s.speed}, plots [${visiblePlots(s).map((p) => `elm ${p.elementIndex} v${p.value}`).join(", ")}]`);
        });
        for (const w of c.warnings) console.log(`warning: ${w}`);
      }
    }
    if (files.length > 1) {
      console.log(`${supported}/${files.length} circuits fully supported`);
      console.log("unported element types by occurrence:");
      for (const [k, v] of [...totals].sort((a, b) => b[1] - a[1])) console.log(`  ${k}\t${v}`);
    }
    break;
  }

  case "run": {
    if (!args[0]) usage();
    const seconds = Number(args[1] ?? 0.01);
    const c = load(args[0]);
    const sim = new Simulator();
    sim.maxTimeStep = c.options.maxTimeStep;
    sim.minTimeStep = c.options.minTimeStep;
    sim.adjustTimeStep = c.options.adjustTimeStep;
    sim.useCircuitOptions(c.options);
    sim.setElements(c.simulatedElements);
    // as CircuitJS does on load: elements keep the state stored in the file
    sim.resetTime();
    while (sim.t < seconds && sim.stopMessage === null) sim.update(() => sim.t >= seconds);
    if (sim.stopMessage) console.log(`stopped: ${sim.stopMessage}`);
    console.log(`t = ${sim.t.toPrecision(6)} s`);
    c.elements.forEach((e, i) => {
      const name = e.constructor.name;
      if (e instanceof PlaceholderElm) console.log(`${i}\t${name}\t(not simulated)`);
      else console.log(`${i}\t${name}\tV=${e.getVoltageDiff().toPrecision(6)}\tI=${e.getCurrent().toPrecision(6)}`);
    });
    break;
  }

  case "roundtrip": {
    // Save → load → save must be stable, and the reloaded circuit must simulate identically.
    let ok = 0, bad = 0;
    const simulate = (c: Circuit, steps: number): number[] => {
      const sim = new Simulator();
      sim.maxTimeStep = c.options.maxTimeStep;
      sim.minTimeStep = c.options.minTimeStep;
      sim.adjustTimeStep = c.options.adjustTimeStep;
      sim.useCircuitOptions(c.options);
      sim.setElements(c.simulatedElements);
      sim.resetTime();
      let n = 0;
      sim.onTimeStep = () => void n++;
      while (n < steps && sim.stopMessage === null) {
        const before = n;
        sim.update(() => n >= steps);
        if (n === before) break; // nothing to simulate
      }
      return c.elements.flatMap((e) => e.volts.slice());
    };
    for (const file of circuitFiles(args)) {
      const problems: string[] = [];
      const text = readFileSync(file, "utf8");
      for (const [name, write] of [["text", writeText], ["xml", writeXml], ["nfg", writeNfg]] as const) {
        try {
          const a = Circuit.parse(text);
          // unported parts can only be written in the format they came from
          if (!isLossless(a, name)) continue;
          const saved = write(a);
          const b = Circuit.parse(saved);
          if (b.elements.length !== a.elements.length) problems.push(`${name}: ${a.elements.length} elements became ${b.elements.length}`);
          const again = write(b);
          if (again !== saved) {
            const l1 = saved.split("\n"), l2 = again.split("\n");
            const i = l1.findIndex((l, k) => l !== l2[k]);
            problems.push(`${name}: second save differs at line ${i + 1}: '${l1[i]}' vs '${l2[i]}'`);
          }
          if (b.scopes.length !== a.scopes.length) problems.push(`${name}: ${a.scopes.length} scopes became ${b.scopes.length}`);
          if (b.adjustables.length !== a.adjustables.length) problems.push(`${name}: ${a.adjustables.length} sliders became ${b.adjustables.length}`);
          if (a.isFullySupported) {
            const va = simulate(Circuit.parse(text), 200), vb = simulate(Circuit.parse(saved), 200);
            const k = va.findIndex((v, j) => v !== vb[j] && !(Number.isNaN(v) && Number.isNaN(vb[j])));
            if (k >= 0) problems.push(`${name}: simulation differs after 200 steps (value ${k}: ${va[k]} vs ${vb[k]})`);
          }
        } catch (err) {
          problems.push(`${name}: ${(err as Error).message}`);
        }
      }
      if (problems.length) {
        bad++;
        console.log(`FAIL: ${basename(file)}`);
        for (const p of problems) console.log(`    ${p}`);
      } else ok++;
    }
    console.log(`\n${ok} round-tripped, ${bad} failed`);
    process.exit(bad ? 1 : 0);
  }

  case "compare": {
    if (!args[0] || !args[1]) usage();
    const c = load(args[0]);
    const rec = JSON.parse(readFileSync(args[1], "utf8")) as {
      every: number;
      elements: { type: string; posts: number }[];
      samples: { n: number; t: number; v: number[] }[];
    };
    if (rec.elements.length !== c.elements.length) {
      console.log(`element count differs: CircuitJS ${rec.elements.length}, NodeForge ${c.elements.length}`);
      process.exit(1);
    }
    // where each element's posts start in a sample's flattened voltage list. Counts are checked
    // after the first step, since analysis can change them (bus widths).
    const offsets: number[] = [];
    let total = 0;
    rec.elements.forEach((re) => {
      offsets.push(total);
      total += re.posts;
    });
    const checkPostCounts = () =>
      rec.elements.forEach((re, i) => {
        const ours = c.elements[i].getPostCount();
        if (ours !== re.posts) console.log(`element ${i}: post count differs (CircuitJS ${re.type} ${re.posts}, NodeForge ${ours})`);
      });
    const sim = new Simulator();
    sim.maxTimeStep = c.options.maxTimeStep;
    sim.minTimeStep = c.options.minTimeStep;
    sim.adjustTimeStep = c.options.adjustTimeStep;
    sim.useCircuitOptions(c.options);
    sim.setElements(c.simulatedElements);
    // as CircuitJS does on load: elements keep the state stored in the file
    sim.resetTime();
    // CircuitJS's tie-breaks (CirSim.getrand) are unseeded, so runs that use them can't match
    let randomCalls = 0, firstRandomStep = -1;
    const getrand = sim.getrand.bind(sim);
    sim.getrand = (n: number) => {
      if (randomCalls++ === 0) firstRandomStep = step + 1;
      return getrand(n);
    };

    // per element: worst absolute error, and when it first exceeded the tolerance
    const tol = Number(process.env.NFSIM_TOL ?? 1e-6);
    const worst = c.elements.map(() => ({ err: 0, n: 0, firstBad: -1 }));
    let step = 0, sample = 0, exact = 0, compared = 0, timeSkew = 0;
    // the first sample with any difference at all, to show where a divergence starts
    let firstDiff = null as { step: number; posts: string[] } | null;
    let firstTimeDiff = null as { step: number; ref: number; ours: number } | null;
    sim.onTimeStep = () => {
      step++;
      if (step === 1) checkPostCounts();
      const s = rec.samples[sample];
      if (!s || s.n !== step) return;
      sample++;
      if (s.t !== sim.t && firstTimeDiff === null) firstTimeDiff = { step, ref: s.t, ours: sim.t };
      timeSkew = Math.max(timeSkew, Math.abs(s.t - sim.t));
      c.elements.forEach((e, i) => {
        for (let p = 0; p < rec.elements[i].posts; p++) {
          const ref = s.v[offsets[i] + p];
          const ours = e.volts[p] ?? 0;
          compared++;
          if (ref === ours) exact++;
          else if (!firstDiff || firstDiff.step === step) {
            firstDiff ??= { step, posts: [] };
            firstDiff.posts.push(`${i}.${p} ${rec.elements[i].type}: CircuitJS ${ref}, NodeForge ${ours}`);
          }
          const err = Math.abs(ref - ours);
          const w = worst[i];
          if (err > w.err) {
            w.err = err;
            w.n = step;
          }
          if (err > tol * Math.max(1, Math.abs(ref)) && w.firstBad < 0) w.firstBad = step;
        }
      });
    };
    const lastStep = rec.samples.at(-1)?.n ?? 0;
    while (step < lastStep && sim.stopMessage === null) sim.update(() => step >= lastStep);
    if (sim.stopMessage) console.log(`stopped: ${sim.stopMessage} at step ${step}`);

    const dt = sim.maxTimeStep;
    console.log(`${sample} samples to step ${lastStep} (t = ${(lastStep * dt).toPrecision(4)} s); ${compared} values, ${exact} bit-identical`);
    console.log(`max time skew ${timeSkew.toExponential(2)} s`);
    const ftd = firstTimeDiff as { step: number; ref: number; ours: number } | null;
    if (ftd) console.log(`time first differs at step ${ftd.step}: CircuitJS t = ${ftd.ref}, NodeForge t = ${ftd.ours}`);
    if (randomCalls > 0) console.log(`random tie-breaks: ${randomCalls}, first in step ${firstRandomStep} (CircuitJS's are unseeded)`);
    const fd = firstDiff as { step: number; posts: string[] } | null;
    if (fd) {
      console.log(`first difference at step ${fd.step} (${fd.posts.length} posts), e.g.:`);
      for (const d of fd.posts.slice(0, 8)) console.log(`  ${d}`);
    }
    const bad = worst.map((w, i) => ({ ...w, i })).filter((w) => w.firstBad >= 0).sort((a, b) => a.firstBad - b.firstBad);
    if (bad.length === 0) console.log(`MATCH: every post within ${tol} (relative, floor 1 V)`);
    else {
      console.log(`DIFFER: ${bad.length} element(s) beyond ${tol}; earliest first:`);
      for (const w of bad.slice(0, 15))
        console.log(`  ${w.i}\t${rec.elements[w.i].type}\tfirst at step ${w.firstBad} (t = ${(w.firstBad * dt).toPrecision(4)})\tmax |err| ${w.err.toExponential(3)} V at step ${w.n}`);
    }
    const overall = Math.max(...worst.map((w) => w.err));
    console.log(`max |err| over all posts: ${overall.toExponential(3)} V`);
    process.exit(bad.length ? 1 : 0);
  }

  default:
    usage();
}
