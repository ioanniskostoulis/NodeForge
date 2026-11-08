# NodeForge interface profile

The profile contains the application-specific values of NodeForge. The shared rules of `GUIDELINES.md` in the pinned `forge-shell` package apply unchanged and are not repeated. [INTERFACE-REFERENCE.md](INTERFACE-REFERENCE.md) records the measured values that are specific to the application, and `forge.config.json` is the machine-readable profile of identity, theme, page slots and packaging. `source/app/domain-profile.ts` supplies the runtime catalogues of menus, commands, inspector sections and panes.

## 1. Identity

| Field | Value |
|---|---|
| Product name and capitalisation | `NodeForge` |
| Lowercase id (package, commands, storage keys) | `nodeforge`; the preferences are stored under `nodeforge.settings` |
| Purpose (one line) | `circuit simulator` |
| Version source | `VERSION` |
| Author and credits | Ioannis Kostoulis; the credits of CircuitJS1 and ngspice are in the About dialog and in `NOTICE.md` |
| Licence | GPL-2.0-or-later |
| App icon source and packaging paths | `assets/icon.png`, `assets/icon/nfg.icns`, `assets/icon/nfg.ico`, `build/electron-builder.json` |
| Application icon capital and ink colour | `N`, `#7188e9` |
| ASCII wordmark path and exact text | `assets/logo.txt`, seven lines of at most 93 characters spelling `NodeForge` |
| Wordmark source, edits and checksum | The Roman font of FIGlet, edited by the owner; SHA-256 `d604bc985a0465023feec6cd76e84b17d22b12d0132f023cf5861798460e58cf` |
| Artwork provenance and asset checksum | One letter of GFS Artemisia, drawn by the owner; SHA-256 of `assets/icon.png` `f0ef076a3c6b37c821652659434e40c5cf6c61a81fd5a06df061f54efd1e43c1`; the licences are in `NOTICE.md` |
| Browser preview port | 5174 |

## 2. Documents

| Field | Value |
|---|---|
| Primary noun | `circuit` |
| Extension and MIME type | `nfg`, `application/vnd.nodeforge.circuit+json`; the macOS type is `com.nodeforge.circuit` |
| Document icon files | `assets/icon/nfg.png`, `nfg.icns`, `nfg.ico`, generated from `assets/icon.png` by `scripts/file-icon.py` |
| Document icon ink colour | `#7288e8`, label `NFG` |
| File association name and role | `NodeForge Circuit`, Editor |
| New | Creates an empty circuit with its own tolerance seed, named `Untitled n` |
| Open | Opens `.nfg`, CircuitJS text and CircuitJS XML; the library circuits open from File › Open example |
| Save and Save as | Write `.nfg`; a circuit opened from a CircuitJS file is saved beside it as `.nfg`. The browser downloads the file. |
| Import | The model library imports SPICE model files and links; circuits are imported by Open |
| Export formats | `.nfg`, CircuitJS XML, CircuitJS text, SPICE netlist and scope CSV |
| Document tabs | Yes; the tabs are circuits |
| Dirty-state rule | A circuit is dirty after an unsaved edit and clean after a successful save |
| Close prompt | Save, Discard, Cancel; Cancel or a failed save keeps the tab |
| Project holds several files | No |
| New view content | An empty sheet at 100% with the tolerance enabled and the `nfg` format |
| Welcome button labels | `New circuit` and `Open…`, with the hint `or pick one from File › Open example` |
| Rename | The Name row of the inspector renames an unsaved circuit by a double click, F2 or the context menu. A saved circuit takes the name of its file and is renamed with Save as, because the shell has no rename operation on disk. |

## 3. Theme

| Token | Dark | Light |
|---|---|---|
| `--accent` | `#7b90df` | `#3c56aa` |
| `--accent-light` | `#7b90df` | `#3c56aa` |
| `--accent-about` | `#899de6` | `#3c56aa` |
| `--accent-fill` | `#3c56aa` | `#3c56aa` |
| `--accent-hover` | `#344c98` | `#344c98` |

| Item | Value |
|---|---|
| Contrast of `--accent-fill` with white, Dark and Light | 6.77:1 in both; the hover fill `#344c98` reaches 7.98:1 |
| Contrast of `--accent` with the input well | 5.66:1 in Dark (`#1b1b1b`) and 6.37:1 in Light (`#f8f8f7`) |
| Semantic data colours | The schematic palette (`source/app/theme.ts`), the scope traces (`source/app/scopes.ts`) and the sheet backgrounds of `public/app.css`, listed under `dataColors` in `forge.config.json`, together with `#1e1e1e`, the window background of the Electron main process |

## 4. Workspace

| Field | Value |
|---|---|
| Centre view | The schematic (`public/center.html`) |
| Inspector sections and default folds | Simulation, Circuit, Tolerance, Adjust, Properties, Part under pointer, grouped by subject (the shell's section 4). Simulation opens with Pause or Run (primary), Reset and Step. Adjust and Slider configuration start closed, and the others start open. |
| Folds that persist | Adjust, Properties, Part under pointer and Slider configuration; the Simulation, Circuit and Tolerance folds are session only |
| Bottom tabs in order | Terminal, Scopes, Messages (`public/panes.html`); Terminal is selected at launch |
| Default panel sizes | Inspector 246 px, bottom panel 246 px; no deviation from the shell |

## 5. Navigation

| Centre view | Pointer | Wheel | Pinch | Pan | Zoom | Keyboard | Drag |
|---|---|---|---|---|---|---|---|
| Schematic | Selects, places parts and draws wires | Zooms at the pointer when the preference Scroll wheel always zooms is on; otherwise a trackpad scroll pans and a mouse wheel zooms | Zooms | Two-finger scroll, middle drag, space drag | Pinch, ⌘ scroll, the View menu | Space tap fits; arrow keys nudge; Esc returns to Select; part keys place | Moves parts, draws a selection box, reshapes wire ends |
| Scope | Chips and tiles in the header; click places cursors | As the schematic | Zooms | As the schematic; over an axis only that axis moves | Over an axis only that axis zooms; ⌥ scroll zooms values | Space fits the plot | A box zooms; a header drag arranges the scope |

## 6. Actions

The menus appear in the order File, Edit, View, Draw, Scopes, Simulation, Help; macOS adds the native NodeForge menu first and the Window menu before Help. Separators are given by `source/app/menus.ts`. The Draw menu lists the supported parts of `public/drawmenu.json` after Select; each part item has the identifier `tool:<class>`, is disabled on the welcome screen and is checked while its tool is active. File › Open example lists the library circuits as `circuit:<file>`, and on desktop View ends with the native Toggle full screen and Developer tools. On the welcome screen the menus keep every item, and the items that need a circuit are disabled.

| Menu | Action ID | Label | Shortcut | Enabled when | Checked when | Welcome |
|---|---|---|---|---|---|---|
| File | `file.new` | New circuit | ⌘N | Always |  | Enabled |
| File | `file.newWindow` | New window | ⇧⌘N | Always |  | Enabled |
| File | `file.open` | Open… | ⌘O | Always |  | Enabled |
| File | `file.recent.<n>`, `file.recent.clear` | Open recent › the last ten files, Clear menu (desktop) |  | Always |  | Enabled |
| File | `file.save` | Save | ⌘S | A circuit is open |  | Disabled |
| File | `file.saveAs` | Save as… | ⇧⌘S | A circuit is open |  | Disabled |
| File | `file.autosave.<choice>` | Autosave › Off, After 1 minute, After 5 minutes, When the window loses focus (desktop) |  | Always | The choice is set | Enabled |
| File | `file.exportNfg` | Export as › NodeForge circuit… |  | A circuit is open |  | Disabled |
| File | `file.exportXml` | Export as › CircuitJS XML… |  | A circuit is open |  | Disabled |
| File | `file.exportText` | Export as › CircuitJS text… |  | A circuit is open |  | Disabled |
| File | `file.exportSpice` | Export as › SPICE netlist… |  | A circuit is open |  | Disabled |
| File | `file.close` | Close | ⌘W | A circuit is open |  | Disabled |
| Edit | `edit.undo` | Undo | ⌘Z | An edit can be undone |  | Disabled |
| Edit | `edit.redo` | Redo | ⇧⌘Z | An edit can be redone |  | Disabled |
| Edit | `edit.cut` | Cut | ⌘X | A circuit is open |  | Disabled |
| Edit | `edit.copy` | Copy | ⌘C | A circuit is open |  | Disabled |
| Edit | `edit.paste` | Paste | ⌘V | A circuit is open |  | Disabled |
| Edit | `edit.duplicate` | Duplicate | ⌘D | A part is selected |  | Disabled |
| Edit | `edit.delete` | Delete | ⌫ | A part is selected |  | Disabled |
| Edit | `edit.selectAll` | Select all | ⌘A | A circuit is open |  | Disabled |
| Edit | `edit.rotateCW` | Rotate clockwise | ⇧⌘R | A part is selected |  | Disabled |
| Edit | `edit.rotateCCW` | Rotate counterclockwise | ⇧⌘L | A part is selected |  | Disabled |
| Edit | `edit.flipH` | Flip horizontal |  | A part is selected |  | Disabled |
| Edit | `edit.flipV` | Flip vertical |  | A part is selected |  | Disabled |
| Edit | `edit.properties` | Properties |  | A part is selected |  | Disabled |
| View | `view.zoomIn` | Zoom in | ⌘= | Always |  | Enabled |
| View | `view.zoomOut` | Zoom out | ⌘- | Always |  | Enabled |
| View | `view.fit` | Fit | ⌘0 | A circuit is open |  | Disabled |
| View | `view.actualSize` | Actual size | ⌘1 | A circuit is open |  | Disabled |
| View | `view.inspector` | Show inspector | ⌘I | Always | The inspector is visible | Enabled |
| View | `view.bottomPanel` | Show bottom panel | ⌘J | Always | The bottom panel is visible | Enabled |
| View | `toggle.showCurrent` | Show current |  | Always | Current display is on | Enabled |
| View | `toggle.showVoltage` | Show voltage |  | Always | Voltage display is on | Enabled |
| View | `toggle.showValues` | Show values |  | Always | Value display is on | Enabled |
| View | `toggle.showReadout` | Show readout under pointer |  | Always | The readout is on | Enabled |
| View | `toggle.showWireJumps` | Show wire jumps |  | Always | Wire jumps are on | Enabled |
| View | `current.shape.dots` | Current markers › Dots |  | Always | The marker shape is dots | Enabled |
| View | `current.shape.arrows` | Current markers › Arrows |  | Always | The marker shape is arrows | Enabled |
| View | `current.shape.squares` | Current markers › Squares |  | Always | The marker shape is squares | Enabled |
| View | `current.electron` | Current markers › Electron flow |  | Always | Electron flow is on | Enabled |
| View | `current.steadyBand` | Current markers › Steady band for fast current |  | Always | The steady band is on | Enabled |
| View | `appearance.light` | Appearance › Light |  | Always | The appearance is Light | Enabled |
| View | `appearance.dark` | Appearance › Dark |  | Always | The appearance is Dark | Enabled |
| View | `toggle.whiteBackground` | Appearance › White background |  | Always | The white background is on | Enabled |
| View | `symbols.us` | Appearance › ANSI symbols |  | Always | The style is ANSI | Enabled |
| View | `symbols.iec` | Appearance › IEC symbols |  | Always | The style is IEC | Enabled |
| View | `temperature.C` | Temperature unit › Celsius (°C) |  | Always | The unit is °C | Enabled |
| View | `temperature.F` | Temperature unit › Fahrenheit (°F) |  | Always | The unit is °F | Enabled |
| View | `temperature.K` | Temperature unit › Kelvin (K) |  | Always | The unit is K | Enabled |
| View | `toggle.wheelZooms` | Scroll wheel always zooms |  | Always | The wheel always zooms | Enabled |
| View | `tab.next` | Next tab | ⌃Tab | A circuit is open |  | Disabled |
| View | `tab.prev` | Previous tab | ⌃⇧Tab | A circuit is open |  | Disabled |
| Draw | `tool.select` | Select | ⎋ | A circuit is open | No part tool is active | Disabled |
| Scopes | `scopes.stack` | Stack all |  | A circuit is open |  | Disabled |
| Scopes | `scopes.unstack` | Unstack all |  | A circuit is open |  | Disabled |
| Scopes | `scopes.combine` | Combine all |  | A circuit is open |  | Disabled |
| Scopes | `scopes.separate` | Separate all |  | A circuit is open |  | Disabled |
| Scopes | `toggle.linkedReadout` | Linked scope readout |  | Always | The linked readout is on | Enabled |
| Scopes | `scope.add` | View selected part in scope |  | A part is selected |  | Disabled |
| Scopes | `scopes.clear` | Remove all scopes |  | A circuit is open |  | Disabled |
| Simulation | `sim.toggle` | Run / pause | ⌘↩ | A circuit is open |  | Disabled |
| Simulation | `sim.step` | Step | ⇧⌘T | A circuit is open |  | Disabled |
| Simulation | `sim.reset` | Reset | ⌘R | A circuit is open |  | Disabled |
| Simulation | `solver.nodeforge` | NodeForge solver |  | Always | The NodeForge solver is chosen | Enabled |
| Simulation | `solver.circuitjs` | CircuitJS solver |  | Always | The CircuitJS solver is chosen | Enabled |
| Simulation | `sim.operatingPoint` | Find DC operating point |  | A circuit is open |  | Disabled |
| Simulation | `sim.power` | Power report |  | A circuit is open |  | Disabled |
| Simulation | `sim.recommend` | Recommend settings… |  | A circuit is open |  | Disabled |
| Simulation | `toggle.backgroundAnalysis` | Analyze circuits in background |  | Always | Background analysis is on | Enabled |
| Simulation | `models.library` | Model library… |  | A circuit is open |  | Disabled |
| Help | `about.whatsNew` | What's new… |  | Always |  | Enabled |
| Help | `about.shortcuts` | Keyboard shortcuts… |  | Always |  | Enabled |
| Help | `about.licenses` | Licenses… |  | Always |  | Enabled |
| Help | `about.updates` | Check for updates… |  | Always |  | Enabled |

The shortcuts of Windows use Ctrl in place of ⌘.

| Group | Buttons | Tooltip text |
|---|---|---|
| Edit history | Undo, Redo | `Undo (⌘Z)`, `Redo (⇧⌘Z)` |
| Edit | Cut, Copy, Paste, Duplicate, Rotate, Delete | The action with its shortcut, such as `Duplicate (⌘D)` |
| View | Fit, Zoom in, Zoom out | `Fit (⌘0)`, `Zoom in (⌘=)`, `Zoom out (⌘-)` |
| Select | Select | `Select (⎋): drag components to move them or empty space to select.` |
| Basic parts | Wire, Resistor, Capacitor, Inductor, Ground | `Resistor (R): click or drag to place.` |
| Part families | Switches and protection, Sources, Active parts, Transformers, Logic gates | The family name; the menu of each flyout lists the parts with their shortcuts |

## 7. Terminal

The command registry is `source/app/commands.ts`. A command is of application scope when it runs on the welcome screen and of document scope otherwise. Output is structured by the shell (lines, columns, groups and tables).

| Command | Syntax | Example | Scope | Runs on welcome | Cancellable | Output |
|---|---|---|---|---|---|---|
| `about` | `about` |  | app | yes | no | Show the About window |
| `ac` | `ac <source> <fstart> <fstop> [points per decade] <quantity>…` | `ac V1 10 1Meg V(R2)` | document | no | no | Sweep a source's AC frequency and plot a Bode plot |
| `analyze` | `analyze [action]` |  | document | no | yes | Report settings or control idle analysis |
| `bench` | `bench [steps]` | `bench 4000` | document | no | yes | Benchmark a copy of the active circuit |
| `changes` | `changes` |  | app | yes | no | Show what is new in this version |
| `clear` | `clear` |  | app | yes | no | Clear the terminal screen |
| `close` | `close [number]` |  | document | no | no | Close a circuit tab |
| `compare` | `compare` |  | document | no | yes | Compare the circuit with ngspice |
| `dcsweep` | `dcsweep <source> <start> <stop> <step> <quantity>…` | `dcsweep V1 0 10 0.1 V(R1) Ic(Q1)` | document | no | no | Sweep a source's DC value and plot the results |
| `delete` | `delete <part>` | `delete R1` | document | no | no | Delete a component |
| `duplicate` | `duplicate <part>` | `duplicate R1` | document | no | no | Duplicate a component |
| `electron` | `electron [state]` |  | app | yes | no | Toggle electron-flow direction |
| `export` | `export <format>` |  | document | no | no | Export the active circuit |
| `fit` | `fit` |  | document | no | no | Fit the schematic in view |
| `font` | `font [size]` | `font 14` | app | yes | no | Show or set the Terminal text size, from 10 to 24 px |
| `help` | `help [command]` |  | app | yes | no | Show commands or detailed usage |
| `history` | `history [number]` | `history 10` | app | yes | no | List or clear command history |
| `info` | `info <part>` | `info R1` | document | no | no | Read a part's values |
| `inspector` | `inspector [action]` |  | app | yes | no | Show, hide or position the inspector |
| `licenses` | `licenses` |  | app | yes | no | Show the licenses |
| `list` | `list [type]` | `list resistor` | document | no | no | List named parts, optionally by type |
| `maxstep` | `maxstep [time]` | `maxstep 50ns` | document | no | no | Show or set maximum time step |
| `model` | `model <part> <model>` | `model Q1 custom` | document | no | no | Assign a model or edit a custom parameter |
| `models` | `models [kind] [search]` |  | app | yes | yes | Search, import or check library models |
| `montecarlo` | `montecarlo [runs]` | `montecarlo 20` | document | no | yes | Measure tolerance spread on a circuit copy |
| `new` | `new` |  | app | yes | no | Create a circuit tab |
| `op` | `op` |  | document | no | no | Find the DC operating point |
| `open` | `open [file]` |  | app | yes | no | Open a library circuit or choose a local file |
| `panel` | `panel <action>` |  | document | no | no | Show, hide or switch the bottom panel |
| `pause` | `pause` |  | document | no | no | Pause simulation |
| `plot` | `plot <what>` | `plot V(D1) vs I(D1)` | document | no | no | Create graphs and change what they show |
| `power` | `power [action]` | `power load R1 on` | document | no | no | Report average power, losses and efficiency |
| `ramp` | `ramp [time]` | `ramp 1ms` | document | no | no | Show or set the start-up ramp of the sources |
| `recent` | `recent [number]` | `recent 2` | app | yes | no | List recent files, or open one by its number |
| `redo` | `redo` |  | document | no | no | Redo a circuit edit |
| `reltol` | `reltol [percent]` | `reltol 0.001%` | app | yes | no | Show or set the solver's relative tolerance |
| `reset` | `reset` |  | document | no | no | Reset the simulation |
| `rotate` | `rotate <part>` | `rotate R1` | document | no | no | Rotate a component 90° clockwise |
| `run` | `run [action]` | `run for 10ms` | document | no | yes | Resume simulation or run for a duration |
| `save` | `save [action]` |  | document | no | no | Save a circuit (download in browser) |
| `scope` | `scope <action>` | `scope stack` | document | no | no | Place scopes: stack, combine, move |
| `seed` | `seed [value]` |  | document | no | no | Read or change the tolerance seed |
| `select` | `select <part>` | `select R1` | document | no | no | Select a part on the sheet |
| `selfheat` | `selfheat [state]` |  | document | no | no | Toggle self-heating of devices with thermal models |
| `set` | `set <part> [property] <value>` | `set R1 4.7k` | document | no | no | Edit a part using inspector property names |
| `shortcuts` | `shortcuts` |  | app | yes | no | Show the keyboard shortcuts |
| `show` | `show [setting] [state]` | `show current steady on` | app | yes | no | Configure schematic displays and current markers |
| `slider` | `slider [action]` | `slider R1 Resistance 1k 10k 4.7k 100` | document | no | no | List, configure or remove adjustable part sliders |
| `solver` | `solver [engine]` |  | app | yes | no | Show or choose the simulation engine |
| `speed` | `speed [multiple]` | `speed 0.01x` | document | no | no | Show or set simulation speed |
| `spice` | `spice` |  | document | no | no | Print the active circuit's SPICE netlist |
| `status` | `status` |  | document | no | no | Show simulation state and settings |
| `step` | `step [number]` | `step 10` | document | no | no | Advance 1–1000 steps while paused |
| `stepsweep` | `stepsweep <part> [property] <values> for <time> <quantity>…` | `stepsweep R1 1k,4.7k,10k for 2ms V(C1)` | document | no | no | Run once per value of a part's property and overlay the results |
| `switch` | `switch <part> [state]` | `switch SW1 on` | document | no | no | Toggle or set a switch |
| `symbols` | `symbols <style>` |  | app | yes | no | Choose ANSI or IEC schematic symbols |
| `tab` | `tab <number>` | `tab 2` | document | no | no | Switch to a circuit tab |
| `tabs` | `tabs` |  | app | yes | no | List circuit tabs |
| `temp` | `temp [value]` | `temp 85` | document | no | no | Show or set the circuit's temperature, or the unit it is shown in |
| `theme` | `theme <appearance>` |  | app | yes | no | Choose appearance |
| `tolerance` | `tolerance [state]` |  | document | no | no | Toggle variation or set a part's tolerance |
| `undo` | `undo` |  | document | no | no | Undo the last circuit edit |
| `updates` | `updates` |  | app | yes | no | Check for a newer version |
| `version` | `version` |  | app | yes | no | Show the version |
| `wheel` | `wheel <mode>` |  | app | yes | no | Choose scroll-wheel behavior |
| `zoom` | `zoom [choice]` | `zoom 150%` | document | no | no | Zoom in or out, fit, show at actual size, or set a percentage |

Aliases accepted and not listed in help: `accuracy`, which sets the relative tolerance or compares with ngspice, and the earlier forms `scope add|trace|plot|list|span|scale|measure|trigger|audio|export|remove|live`, which `plot` replaces.

Welcome-state commands and their completion choices: `clear`, `electron`, `help`, `history`, `inspector`, `models`, `new`, `open`, `reltol`, `show`, `solver`, `symbols`, `tabs`, `theme` and `wheel`, with the restricted forms `analyze auto [on|off]`, `panel <on|off|terminal>`, `scope linked [on|off]` and `temp unit <C|F|K>`. Any other command answers `Open a circuit first.`. [CONSOLE.md](CONSOLE.md) describes each command.

## 8. Messages

| Event | Kind | Text | Object link | Standing key |
|---|---|---|---|---|
| Circuit renamed | Info | `Circuit renamed to <name>.` | No | None |
| DC operating point found | Info | `DC operating point found` with the method | No | None |
| No operating point | Warning | `No DC operating point found. The circuit may not have a stable equilibrium.` | No | None |
| Unsupported part | Warning | `<type>: unsupported component, left out of the simulation.` | Part | `unsupported <type>` |
| Model problem or part problem | Warning or Error | The problem, from the part | Part | Per part |
| Stopped simulation | Error | The stop message of the solver | No | Per condition |
| Circuit cannot be read | Error | `Couldn't read the circuit: <reason>` | No | None |
| Analysis failed | Error | `Analysis failed: <reason>` | No | None |
| Invalid inspector field | Error | `Invalid <field>. Enter a number in <unit>.` | No | None |
| Invalid name | Error | `Enter a name.`, `A name cannot contain / or \.`, `The name <name> is already used.` or `Use Save as to give this circuit another name.` | No | None |

Each circuit keeps its own log of 500 entries, which is not saved. The standing conditions are logged once, with a quiet period of 30,000 ms.

## 9. Persistence

| Value | App preference | Document | Session only |
|---|---|---|---|
| Appearance, inspector visibility, side and width, bottom panel visibility and height, Terminal font size | Yes | No | No |
| Current, voltage and value display, wire jumps, readout, linked scope readout, symbol style, temperature unit, white background, current marker shape, steady band and arrows, current marker speed, wheel behaviour | Yes | No | No |
| Solver, relative tolerance, background analysis | Yes | No | No |
| Folds of Adjust, Properties, Part under pointer and Slider configuration | Yes | No | No |
| Schematic, parts, models, simulation settings, scopes, triggers, scope views, sliders, tolerance seed, temperature, self-heating, start-up ramp | No | Yes | No |
| Active bottom pane (Terminal at launch), folds of Simulation, Circuit and Tolerance, selection, hover, undo history, Terminal history, Messages log, sweep scopes, audio choices | No | No | Yes |

Window size and position are not remembered. An invalid or removed preference falls back to its default when the preferences are loaded.

## 10. Verification

| View or flow | How to reach it | What to confirm |
|---|---|---|
| Welcome and welcome Terminal | Launch; type `help` | The banner; the overview lists only the welcome commands; the buttons wrap in a narrow column |
| Open document | `new`, or File › Open example | Tabs, dirty dot, inspector, panels and status bar |
| Rename | A double click on the Name row | The tab, the status bar and Messages follow the name |
| Appearances | `theme dark`, `theme light` | Accents, legible text |
| Menus | The menu bar | Order, labels, shortcuts, checked and disabled states with and without a circuit |
| Information dialogs | Help | Each opens with the wordmark and closes by button, Esc and backdrop |
| Messages and status | Enter an invalid field value | The error appears in the status bar and in Messages, and the inspector keeps its size |
| Save flow | Edit, then close the tab | Save, Discard and Cancel; Cancel keeps the tab |
| Document round trip | `npm run checks`, `tests/nfg-format.mjs` | Every sample circuit reads back unchanged |
| Reduced motion | The system setting | Final states appear immediately |

Platform checks: the packaged macOS application is launched by hand; the Windows build, the installer check and the launch screenshot are automated.

The shell is pinned as `source/forge-shell-4.0.0.tgz`, and `scripts/check-release.mjs` verifies the archive, the installed version and the copy in the release source.
