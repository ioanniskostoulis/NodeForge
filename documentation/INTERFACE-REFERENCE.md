# Interface reference

This document records the measured interface of NodeForge that is specific to the application. The shared values (tokens, geometry, motion, text roles, Terminal and Messages rules) are stated once, in `GUIDELINES.md` of the pinned `forge-shell` package, and are not repeated here. The product choices are in [INTERFACE.md](INTERFACE.md).

## Menus

The registry `source/app/commands.ts` defines the identifiers, labels, shortcuts and Terminal syntax, and `source/app/menus.ts` builds the native menu and the browser menu from it.

| Platform | Top-level order |
|---|---|
| Browser and Windows | File, Edit, View, Draw, Scopes, Simulation, Help |
| macOS desktop | NodeForge, File, Edit, View, Draw, Scopes, Simulation, Window, Help |

| Menu | Content |
|---|---|
| File | New circuit, New window (desktop), Open…, Open example (a submenu of the library), Save, Save as…, Export as (NodeForge circuit…, CircuitJS XML…, CircuitJS text…, SPICE netlist…), Close |
| Edit | Undo, Redo; Cut, Copy, Paste, Duplicate, Delete; Select all; Rotate clockwise, Rotate counterclockwise, Flip horizontal, Flip vertical; Properties |
| View | Zoom in, Zoom out, Fit, Actual size; Show inspector, Show bottom panel; Show current, Show voltage, Show values, Show readout under pointer, Show wire jumps; Current markers; Appearance (Light, Dark, White background, ANSI symbols, IEC symbols); Temperature unit; Scroll wheel always zooms; Next tab, Previous tab; on desktop, full screen and Developer tools |
| Draw | Select, then the part groups of `public/drawmenu.json` that are supported |
| Scopes | Stack all, Unstack all, Combine all, Separate all; Linked scope readout; View selected part in scope; Remove all scopes |
| Simulation | Run or pause, Step, Reset; NodeForge solver, CircuitJS solver; Find DC operating point, Power report; Recommend settings…, Analyze circuits in background; Model library… |
| Help | About NodeForge (outside the macOS application menu), What's new…, Keyboard shortcuts…, Licenses… |

| Shortcut | Action |
|---|---|
| ⌘Z, ⇧⌘Z | Undo, Redo |
| ⌘X, ⌘C, ⌘V, ⌘D | Cut, Copy, Paste, Duplicate |
| ⇧⌘R and ⇧⌘L | Rotate clockwise and counterclockwise |
| ⌘I, ⌘J | Inspector, bottom panel |
| ⌘↩, ⇧⌘T, ⌘R | Run or pause, Step, Reset |
| ⌘0, ⌘=, ⌘-, ⌘1 | Fit, Zoom in, Zoom out, Actual size |
| ⇧⌘S | Save as |

The shortcut list of the dialog is generated from the registry and from the shortcuts of the part tools; the Ctrl equivalents apply on Windows.

## Tool strip

| Group | Content |
|---|---|
| 1 | Undo, Redo |
| 2 | Cut, Copy, Paste, Duplicate, Rotate, Delete |
| 3 | Fit, Zoom in, Zoom out |
| 4 | Select |
| 5 | Wire, Resistor, Capacitor, Inductor, Ground |
| 6 | Flyouts: Switches and protection, Sources, Active parts, Transformers, Logic gates |

Part icons are schematic miniatures of 26 × 16 px, and action icons are line drawings of 16 × 16 px. The mode text reads `Select` or `Place <part>. Press Esc to finish`. `TOOLBAR_SEARCH` is `false` in `source/app/tool-strip.ts`, so the part search is not shown.

## Workspace

| Item | Value |
|---|---|
| Centre view | The schematic (`public/center.html`) |
| Inspector sections | Simulation, Circuit, Tolerance, Adjust, Properties, Part under pointer |
| Initial folds | Simulation, Circuit, Tolerance, Properties and Part under pointer open; Adjust and Slider configuration closed |
| Persistent folds | Adjust, Properties, Part under pointer, Slider configuration |
| Bottom tabs | Terminal, Scopes, Messages (`public/panes.html`) |
| Name row | Renames an unsaved circuit by a double click or F2; a saved circuit is renamed with Save as |
| Welcome state | `No circuit open`, `New circuit`, `Open…` and a hint to File › Open example; the buttons wrap in a narrow column |

## Status bar

| Part | Content |
|---|---|
| State | `Running` or `Paused`, with the simulation time |
| Readouts | Cursor coordinates, grid size and zoom percentage |
| Problems | The unseen count, which opens Messages |

`source/app/main.ts` supplies the state, summary, detail, hint and readouts, and the shell draws them.

## Terminal

The commands of NodeForge are `ac`, `analyze`, `bench`, `clear`, `close`, `compare`, `dcsweep`, `delete`, `duplicate`, `electron`, `export`, `fit`, `help`, `history`, `info`, `inspector`, `list`, `maxstep`, `model`, `models`, `montecarlo`, `new`, `open`, `op`, `panel`, `pause`, `plot`, `power`, `ramp`, `redo`, `reltol`, `reset`, `rotate`, `run`, `save`, `scope`, `seed`, `select`, `selfheat`, `set`, `show`, `slider`, `solver`, `speed`, `spice`, `status`, `step`, `stepsweep`, `switch`, `symbols`, `tab`, `tabs`, `temp`, `theme`, `tolerance`, `undo`, `wheel` and `zoom`. The command `accuracy` is a hidden alias. [CONSOLE.md](CONSOLE.md) gives the syntax.

| State | Commands available |
|---|---|
| No circuit open | `clear`, `electron`, `help`, `history`, `inspector`, `models`, `new`, `open`, `reltol`, `show`, `solver`, `symbols`, `tabs`, `theme`, `wheel`, and the forms `analyze auto [on\|off]`, `panel <on\|off\|terminal>`, `scope linked [on\|off]` and `temp unit <C\|F\|K>` |
| A circuit open | Every command |

A command that requires a circuit answers `Open a circuit first.` on the welcome screen.

## Information dialogs

| Dialog | Content specific to NodeForge |
|---|---|
| About | The headings `Built on earlier work` and `Developed further for NodeForge`; credits for Paul Falstad, Iain Sharp, Rodrigo Hausen, the CircuitJS1 contributors and the ngspice contributors; the GPL summary |
| What's new | The `## <VERSION>` section of the shipped `CHANGELOG.md`, else the newest section, else `The release notes for this version aren't available.` |
| Keyboard shortcuts | The groups `Menus` and `Placing parts` |
| Licenses | The licence of NodeForge, the works included from others, the full GPL text and the text of the ngspice licence |

## Domain colours

The schematic palette lies in `source/app/theme.ts` (Dark, Light and White background), the scope trace palette in `source/app/scopes.ts`, and the sheet background of the welcome state and the canvas in `public/app.css`. These colours carry data or drawing content and are listed under `dataColors` in `forge.config.json`, together with `#1e1e1e`, the window background of the Electron main process, which equals `--window` in Dark. The shell offers no constant for that value.
