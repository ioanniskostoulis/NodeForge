# Architecture

NodeForge is one TypeScript code base with three front ends over one engine.

| Front end | Location | Property |
|---|---|---|
| Desktop application | `source/desktop` (Electron main process and preload) with `source/app` | Native menus, file dialogs and ngspice checks |
| Browser application | `source/app` | The same interface, with the file-access limits of a browser |
| `nfsim` | `source/cli` | Command-line runner: simulation, tests, comparison and SPICE export |

## Engines

The directory `source/engine` is plain TypeScript without dependence on the DOM or on Node and holds two engines.

| Engine | Construction | Property |
|---|---|---|
| `circuitjs` | A port of CircuitJS1, file by file, with the class names of the Java source (`ResistorElm`) kept so that each file can be compared with its original | Reproduces CircuitJS1 exactly: every part, the file formats and the fixed-step simulator. Elements expose geometry and state, and the drawing lies in a separate layer in `source/app`. |
| `nodeforge` | Builds on `circuitjs` | Error-controlled steps, SPICE-style Newton iteration, sparse LU factorization, the DC operating point and diagnostics. `AccurateSimulator` subclasses the CircuitJS simulator and runs as CircuitJS while the NodeForge solver is off. |

CircuitJS mode must remain bit-exact. Simulation behaviour is never changed in `circuitjs` and is placed in `nodeforge`; the few branches inside CircuitJS parts carry a comment that begins `NodeForge engine:`.

## Layout

| Path | Content |
|---|---|
| `source/engine/circuitjs` | Simulator, parts (`elements/`), file formats (`io/`: CircuitJS text and XML, and `.nfg`) and the replay of upstream data (`testing/`) |
| `source/engine/nodeforge` | Solver, operating point, DC and AC analysis, `sparse.ts`, `snapshot.ts`, `spice.ts` (ngspice export), `devices/` (ported from ngspice 47), `spice/` (parser, expressions, model registry), `elements/` and `extensions.ts` (hooks) |
| `source/engine/index.ts` | Public interface of the engine |
| `source/app` | Interface: canvas, renderer, symbols, inspector, scopes, menus, model library, Messages and console |
| `source/desktop` | Electron main process and preload, over the window state, native menu and IPC helpers of the shell |
| `source/cli` | `nfsim` |
| `source/forge-shell-<version>.tgz` | The pinned shell package |
| `public` | Page slots, styles, the 373 library circuits (`circuits/`), `drawmenu.json` and the generated `models.json` |
| `assets` | Application icon, document icons (`icon/`), ASCII wordmark, licence texts (`licenses/`) and `models/generic.lib` |
| `tests` | Upstream test circuits, accuracy and device circuits compared with ngspice, oracle lists, interface tests and `checks.json` |
| `scripts` | Build, preview, oracle and release checks |
| `documentation` | This folder |
| `forge.config.json` | Identity, document, accents, page slots and packaging metadata read by the shell |

## Interface modules

| File | Role |
|---|---|
| `main.ts` | Wiring, `run()` of the menus, keys, opening and saving |
| `model.ts` | `SimulationModel`: circuit, scopes, sliders, designators and models |
| `document.ts` | One tab: undo, redo and saved state |
| `commands.ts` | One registry for menu items, shortcuts and console syntax |
| `inspector.ts`, `properties.ts` | Right panel; names and units of properties |
| `scopes.ts`, `scope-math.ts`, `recording.ts` | Scope drawing and navigation; cells, statistics and FFT; recordings with OPFS spill |
| `canvas.ts`, `renderer.ts`, `symbols.ts`, `labels.ts` | Schematic, drawing, symbols and label placement |
| `model-library.ts`, `model-catalog.ts`, `model-params.ts` | Model library, naming and custom models |
| `messages.ts`, `terminal.ts`, `motion.ts`, `wheel.ts` | Re-exports or thin wrappers of the shell modules |
| `profile.ts`, `domain-profile.ts` | Identity of the application and its catalogues of menus, commands, inspector sections and panes |
| `recommend*.ts` | Background analysis for the recommended settings |

## Boundary with the shell

NodeForge owns the circuit: engine, schematic, scopes, models, inspector contents, menus and commands. `forge-shell` owns the frame and the behaviour shared with other Forge applications, and takes its data and callbacks from `forge.config.json` and the runtime profile, never from application code. A change that every Forge application should share is made in the shell and released as a tag, after which NodeForge raises its pin.
