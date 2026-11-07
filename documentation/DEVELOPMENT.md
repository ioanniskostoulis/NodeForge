# Development

NodeForge requires Node.js 22.12 or newer on macOS or Windows. The workflows use Node 22. ngspice is required only for the accuracy checks: `brew install ngspice` on macOS, or `ngspice_con.exe` on the `PATH` or in `C:\Program Files\Spice64\bin`.

## Given values

| Value | Setting |
|---|---|
| Preview port | 5174, bound to `127.0.0.1`; `PORT=<port>` overrides it |
| Build output | `build/app`, `build/desktop`, `build/engine`, `build/nfsim.cjs`, `build/release` |
| Shell | `forge-shell`, pinned as the archive in `source/` (see `package.json`) |
| Release files | `NodeForge-v<version>.dmg` and `NodeForge-v<version>.exe` |

## Commands

| Command | Action |
|---|---|
| `npm install` | Installs the dependencies and the local Git hook |
| `npm run build` | Bundles into `build/`, wiping and recopying `build/app` |
| `npm run check` | Typechecks |
| `npm test` | Builds, then runs the upstream regression tests; seven must pass |
| `npm run test:app` | Runs the interface tests (29 files, including the conformance tests of the shell) |
| `npm run test:shell` | Builds, then runs `forge-shell check-app` against `forge.config.json`; `FORGE_STYLE_LINT=error` turns style reports into errors |
| `npm run checks` | Runs every check of the section "Checks" against `tests/checks.json`; `--only` and `--skip` take check names, `--verbose` lists each accuracy circuit |
| `npm run accuracy` | Compares the accuracy circuits with ngspice |
| `npm run gallery` | Draws every part by group and in eight directions, with a geometry check |
| `npm run web` | Serves the browser preview at `http://127.0.0.1:5174`, rebuilt on each edit |
| `npm start` | Builds and starts the desktop application |
| `npm run dev` | Starts the desktop application with rebuild and reload on edits |
| `npm run dist` | Packages the macOS DMG, or on Windows the unpacked application and the Forge setup |
| `npm run dist:win-app` | Builds the unpacked Windows application only |
| `npm run installer` | Wraps `build/release/win-unpacked` with the setup engine of the shell |

A circuit is tried in the browser by copying it into `build/app/circuits/_test/`, which a build wipes, and opening `http://127.0.0.1:5174/?c=_test/name.xml`.

| Variable | Effect |
|---|---|
| `FORGE_CAPTURE=<png>` | Writes an image of the window after launch; `FORGE_CAPTURE_DELAY` sets the delay in milliseconds |
| `FORGE_PANEL=terminal` | Opens the named bottom pane |
| `FORGE_DEV_URL` | Points the window at a development server |

`npm run dev` uses a separate data folder, `NodeForge Dev`. The `NODEFORGE_*` names of these variables are still read.

## Checks

The checks run after a change of the engine or of a file format. `npm run checks` runs all of them.

| Command | Expected result |
|---|---|
| `npm test` | 7 passed |
| `sh scripts/oracle-compare.sh tests/oracle/oracle-all.txt` | Equal to `tests/oracle/oracle-full.txt` in the first three fields, so that CircuitJS mode is bit-exact |
| `node build/nfsim.cjs bench public/circuits` | 373 circuits, 0 failed |
| `node build/nfsim.cjs bench public/circuits --circuitjs` | 373 circuits, 0 failed |
| `node build/nfsim.cjs bench public/circuits --op` | Newton 365, failed 7, gmin stepping 1 |
| `node build/nfsim.cjs roundtrip public/circuits` | 365 round-tripped, 8 failed |
| `node build/nfsim.cjs accuracy tests/accuracy` | Each circuit within its limit of `tests/checks.json`, about 0.07%; the ZVS circuits about 0.10% |
| `node build/nfsim.cjs accuracy tests/devices/<file>.xml` | Each circuit within its limit, 0.01% unless `tests/checks.json` states another |
| `node build/nfsim.cjs models assets/models/generic.lib --json --check > public/models.json` | Run after an edit of the generic models |

The file `tests/checks.json` is updated when a result changes on purpose. Accuracy is measured against ngspice and not against CircuitJS. The oracle requires the official CircuitJS1 application (`CIRCUITJS_WAR`, see `.env.example`) only to record new data; the comparison uses `tests/oracle`.

## nfsim

`node build/nfsim.cjs <command>` is the command-line runner.

| Command | Action |
|---|---|
| `info <file\|dir>` | Lists part support, sliders and scopes |
| `run <file> [seconds]` | Simulates and prints the voltage and current of each part |
| `test <file\|dir>` | Replays upstream regression data |
| `compare <file> <recording.json>` | Compares with a recording of the official CircuitJS1 |
| `roundtrip <file\|dir>` | Saves as text, XML and `.nfg`, reloads and checks that nothing changed |
| `xml <file>`, `nfg <file>` | Prints the circuit in that format |
| `spice <file>` | Exports an ngspice netlist |
| `accuracy <file\|dir> [--reltol n] [--circuitjs]` | Compares every node with ngspice |
| `bench <file\|dir> [--op] [--diag] [--top n] [--dense]` | Measures robustness and speed, operating points and solver effort |
| `analyze <file>` | Runs the background analysis behind the recommended settings |
| `op <file>` | Finds the DC operating point and compares it with the `.op` of ngspice |
| `dcsweep <file> <source> <start> <stop> <step>` | Compares a DC sweep with ngspice |
| `ac <file> <source> <fstart> <fstop> [per decade]` | Compares an AC sweep with ngspice |
| `models <file> [--check] [--json]` | Lists a model file and checks each model against ngspice |
| `montecarlo <file> --runs n --probe P [--csv file]` | Runs with parts varied within their tolerances |

The argument `source` is a number, 1 being the first independent source of the circuit. Oracle data is recorded with `node scripts/oracle.mjs --steps 40000 --every 20 --head 60 circuit.txt`, after which the printed address is opened.

## Shell

The frame, tabs, menus, Terminal, Messages, dialogs, desktop helpers and the build and release scripts come from `forge-shell`. The package is a versioned `npm pack` archive of a tag of the private repository, so that the workflows need no second credential. The integrity field of `package-lock.json` pins the archive, and `scripts/check-release.mjs` compares the archive, the installed version and the copy in the release source (`vendor/forge-shell`). The directory `node_modules/forge-shell` is never edited; a change of shared behaviour is made in the repository of the shell.

| Step | Action |
|---|---|
| 1 | A tag is released in the shell repository. |
| 2 | `npm pack` is run on a clean checkout of the tag; the archive is placed in `source/`, `dependencies.forge-shell` is pointed at it and `npm install` is run. The previous archive is removed after the checks pass. |
| 3 | The changelog of the shell is read from the old tag to the new one, and `forge.config.json` and the four caller workflows are updated. |
| 4 | `npm run check`, `npm test`, `npm run test:app`, `npm run test:shell`, `npm run dist` and `node scripts/check-release.mjs --mac` are run, and the served application is inspected in Dark and Light. |
| 5 | The new shell version is noted in `CHANGELOG.md`. A failed update is reverted by restoring the previous archive and lockfile. |

## Versions and releases

| Subject | Rule |
|---|---|
| Version | The owner edits `VERSION`. The commit hook copies it to `package.json` and `package-lock.json` and raises the patch number at each ordinary commit. The build fails when the three differ. |
| Changelog | `CHANGELOG.md` holds a `## <VERSION>` section at the top. Help › What's new and the release notes read it. |
| Release | Release `v<VERSION>` receives both installers after the checks and both builds succeed. A push of documentation only does not build. |
| Signing | Neither installer is signed or notarized. |

| Workflow (file) | Action |
|---|---|
| Build desktop apps (`build-desktop-apps.yml`) | Runs on pushes to `main`, on `v*` tags and by hand. It runs `check`, `test`, `test:app` and `test:shell`, builds both applications and publishes both installers. |
| Build for mac (`build-for-mac.yml`) | Runs the checks, builds and publishes the DMG only. |
| Build for windows (`build-for-windows.yml`) | Runs the checks, builds and publishes the setup only. The job also launches the packaged application with a screenshot and installs, repairs, downgrades and uninstalls the setup. |
| Clear all (`clear-all.yml`) | Deletes every release and tag when **confirm** is `clear all`. It builds nothing. |
| Full checks (`full-checks.yml`) | Runs `npm run checks` with ngspice on macOS, by hand. |

### Windows setup

The setup is built by the engine of the shell from `build/release/win-unpacked` and written to `build/release/NodeForge-v<VERSION>.exe`. It requests administrator rights and installs for all users in `C:\Program Files\Forge\NodeForge`. The Settings entry and the `.nfg` association are written under `HKLM`, and the shortcut is placed in the common Start menu. Data in `%APPDATA%` is kept. `scripts/check-windows-installer.ps1` verifies installation, repair, downgrade refusal, document icon and uninstallation on the runner. The setup removes neither an older NSIS installation in Program Files nor a per-user installation of `%LOCALAPPDATA%\AppForge\NodeForge`, which was made by an earlier version; the latter is removed by its own `/uninstall`.

### Checks of a build

```bash
node scripts/check-release.mjs
```

```bash
node scripts/check-release.mjs --mac
```

The source comparison refers to the current checkout, so the build is repeated after a change of source or documentation. The open provenance checks are listed in `NOTICE.md`.
