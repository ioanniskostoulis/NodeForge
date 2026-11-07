# Console

The Terminal tab runs the commands of NodeForge in the browser and in the desktop application, including the `nfsim` tools. It is an application console and not an operating-system shell: file access is limited to opening and saving circuits and importing models. The command `help` lists the commands, and `help <command>` gives the syntax, choices, defaults and an example (`help scope audio`, `help scope trigger`). The placeholder brackets are not typed.

## Conventions

| Subject | Rule |
|---|---|
| Syntax | `thing [value]`; the verbs are short and lowercase, `<value>` is required and `[value]` is optional. |
| Values | Values are written as the inspector takes them (`4.7k`, `50ns`, `0.01%`), and parts by designator (`R1`, `Q2`). |
| Keys | Tab completes commands, arguments, designators and model names. ↑ and ↓ walk the history. Ctrl+C cancels a running analysis, benchmark, Monte Carlo run or ngspice check. Esc leaves the prompt. |
| History | The history belongs to the opened circuit and is not stored. It holds one copy of each command, the last 100. `history`, `history <number>` and `history clear` list or empty it. |
| Errors | Invalid arguments are rejected before anything changes. Circuit edits can be undone; application preferences cannot. |
| Welcome screen | With no circuit open, help and completion offer only the commands that run from the welcome screen. |
| Text size | The platform modifier with + or − sets 10 to 24 px, and the size is remembered. |
| Comments | A plain hyphen introduces an explanatory comment in the output. Menu labels, shortcuts and console syntax share `source/app/commands.ts`. |

## Commands

### Simulation and analysis

```text
status
run
run for <duration>
pause
step [number]
reset
op
solver [engine]
reltol [percent]
maxstep [time]
temp [°C]
selfheat [state]
ramp [time|off]
speed [multiple]
compare
analyze
analyze apply
analyze auto [state]
```

- `status` reports circuit, state, time, solver, tolerance, maximum step and speed.
- `run for <duration>` advances the active circuit at computation speed and pauses at the first
  solver step at or after the target. Reports actual elapsed time. Ctrl+C cancels; edits stop
  the run. Partial progress remains. Computation limit: 120 seconds.
- `solver`, `reltol`, `maxstep`, `temp` and `speed` report their current values without arguments.
- `temp` sets the circuit's temperature in °C (25 unless set; saved with the circuit). SPICE device
  models follow it; parts on CircuitJS models follow it on the NodeForge solver only.
- `selfheat` toggles self-heating (saved with the circuit): diodes with RTH0 and VDMOS with RTHJC
  heat up by the power they dissipate.
- Engines: `nodeforge` (`accurate` still accepted), `circuitjs`. States: `on`, `off`.
- `reltol` accepts 0.1%, 0.01%, 0.001% and 0.0001%. Applies to the NodeForge solver.
- `compare` compares a circuit copy with desktop ngspice.
- Legacy `accuracy <percent>` still sets tolerance. `accuracy` and `accuracy check` still compare
  with ngspice. `help accuracy` explains the replacement commands.
- `step` defaults to 1; accepts 1–1000. `maxstep` takes SI time values such as 50ns.
- `speed` takes a multiple of real time, such as 0.01x.
- Automatic analysis starts after 1.5 seconds without edits. Its state is a saved app preference.

### Components and tolerance

```text
list [type]
info <part>
dcsweep <source> <start> <stop> <step> <quantity>…
ac <source> <fstart> <fstop> [points per decade] <quantity>…
stepsweep <part> [property] <values> for <time> <quantity>…
power [reset]
power load <part> [on|off]
select <part>
set <part>
set <part> [property] <value>
delete <part>
duplicate <part>
rotate <part>
switch <part> [state]
switch <part> <position>
switch <part> status
tolerance [state]
tolerance <part> <percent>
seed
seed <number>
seed new
model <part> <model>
model <part> custom
model <part> <parameter> <value>
slider
slider <part> <property> <minimum> <maximum> <value> <step>
slider remove <part> <property>
```

- Parts use designators such as R1. Property names match the inspector; quote names with spaces.
  `set` takes every property the inspector shows, by its name or its symbol: the part's own fields
  (`set R1 R 4.7k`), its model (`set M1 model IRF540`), each tolerance (`set M1 "Beta tolerance" 10`
  or `set M1 Δβ 10`), a library power MOSFET's heatsink (`set M1 Rth 5`, °C/W), Load, and a custom
  model's parameters (`set M1 vto 2.5`). `set <part>` alone lists them, symbols in brackets.
- Delete, duplicate and rotate act on the named component and support undo. Rotate is 90° clockwise.
  Duplicate selects a copy offset by two grid spaces in each direction.
- `switch` toggles without an argument. `on` closes a two-terminal switch; `off` opens it.
  Multi-throw switches and logic inputs use positions starting at 1. Linked switches operate
  together. Supports undo. Momentary switches keep their selected state until changed again.
- Tolerance states are `on` and `off`; no argument toggles variation. Off uses nominal values.
- Seeds range from 1 to 99999 and reproduce component variation.
- Slider step 0 is continuous; otherwise it must divide the range and include the current value.

### Plots and scopes

`plot` makes graphs and changes what one shows; `scope` places the scopes in the panel.

```text
plot <expression>
plot <expression> vs <expression>
plot fft <expression>
plot <part> [quantity]
plot <expression> in <number>
plot mode <number> <type>
plot list
plot remove <number>
plot live [number]
plot span <number> <time>
plot scale <number>
plot scale <number> auto
plot scale <number> <unit> <per-division> [center]
plot measure <number>
plot measure <number> <measurement> <state>
plot trigger <number>
plot trigger <number> <edge>
plot trigger <number> level <value>
plot trigger <number> trace <trace>
plot audio <number>
plot audio <number> <state>
plot audio <number> mode <mode>
plot audio <number> trace <trace>
plot export <number> csv

scope stack
scope unstack
scope combine
scope separate
scope move <number> <side> <number>
scope clear
scope linked [state]
```

The older `scope add`, `scope trace`, `scope plot`, `scope list`, `scope span`… still work, but only
the forms above are listed in `help` and completed.


- Span sets the full live time window, at least one maximum time step. Manual vertical scale uses
  V, A, W or C per division; center defaults to 0. These view settings are session-only and apply
  to time plots. Native time-scale changes clear the span override.
- Plot types: `time`, `fft`, `xy`. X-Y needs two visible traces.
- Quantities (`plot <part> <quantity>`, expressions): any a part offers in its scope menu: `V`, `I`, `P`; `Vbe`, `Vbc`, `Vce`, `Ib`, `Ic`, `Ie` on a transistor; `Vds`, `Id`, `Vgs`, `Ig` on a MOSFET; `R`, `Q` where parts have them. In expressions they're written as in scope legends, `Vgs(M1)`, and combined with `+ - * / ^`, numbers with SI prefixes (`10k`), `pi`, and `abs`, `sqrt`, `exp`, `ln`, `log10`, `sin`, `cos`, `tan`, `min`, `max`, `pow`.
- `plot` opens a new scope (`plot <expression> in <number>` adds to one): `plot V(D1)*I(D1)` over time, `plot Id(M1) vs Vds(M1)` as Y against X (titled "Id vs Vds"), `plot fft V(R1)` as a spectrum. It navigates like any scope, with its Sound and Auto tiles; expression traces save with the circuit (`.nfg` or XML).
- Measurements: `peak`, `minimum`, `p2p`, `average`, `rms`, `overshoot`, `frequency`, `period`, `duty`, `width`, `rise`, `fall`, `phase`, `energy`, `cycleenergy`, `efficiency`. States: `on`, `off`.
  Bare `scope measure <number>` lists states. Plot and measurement flags support undo and save.
- CSV export pauses simulation and exports all recorded intervals for visible traces. Columns
  contain interval start/end times in seconds and minimum/maximum values in SI units. This is
  the stored envelope, not individual adaptive solver samples. Headers identify each trace.
  Missing or expired full-resolution data produces an error, never silent downsampling.
  Limits: 1000000 cells and 64 MB. Ctrl+C cancels. Desktop uses a save dialog; browser downloads.
- Scope and visible-trace numbers start at 1. `plot list` lists traces in display order within each
  scope. Bare `scope`, `scope help` and `help scope` show the action catalogue.
- Quantities: `V` voltage, `I` current, `P` power; a part's own too (`Vgs`, `Ic`…, `Tj` the junction temperature of a diode or MOSFET with a thermal model). Omit quantity for the component's default traces.
- Trigger edges: `rising`, `falling`, `off`. Level accepts signed SI values in the selected trace's
  unit, or `midpoint`. Changing trace resets the level to midpoint. Applies to time plots.
- Trigger changes support undo and save with the circuit. A query changes nothing.
- Audio states: `on`, `off`. Modes: `waveform` (simulation speed), `pitch` (value mapped to pitch),
  `realtime` (recent waveform repeated at real-time speed). Realtime needs at least 20 ms of recorded circuit
  time and updates its loop as the solver advances. Mode and trace changes preserve the current
  on/off state. Only one scope plays at a time. Pausing silences playback.
- First audio use selects the first visible trace in waveform mode. Last mode and trace are remembered
  for the scope during the session; audio settings are not saved in circuit files.
- Linked readout states: `on`, `off`. Omit state to query; off by default.
- `scope clear` removes all docked scopes. `scope live` defaults to scope 1.

### View and display

```text
inspector [action]
fit
zoom [choice]
zoom <percent>
theme <appearance>
font [size]
panel <action>
show
show <setting> [state]
show current <shape>
show current steady [state]
show current direction <state>
symbols <style>
electron [state]
wheel <mode>
```

- `zoom` reports magnification without arguments. Choices: `in`, `out`, `fit`, `actual` (View › Zoom in, Zoom
  out, Fit and Actual size); a percentage such as `150%` sets the magnification.
- `font` shows or sets the Terminal text size, 10 to 24 px; `bigger` and `smaller` step it by 1 px.
- Inspector actions: `on`, `off`, `left`, `right`. No argument toggles visibility.
- Appearances: `dark`, `light`. Panel actions: `on`, `off`, `terminal`, `scopes`, `messages`.
- Display settings: `current`, `voltage`, `values`, `readout`, `jumps`. States: `on`, `off`.
  A setting without a state toggles it; bare `show` lists the states.
- Marker shapes: `dot`, `arrow`, `square`; plural forms also work. Shape changes preserve visibility
  and direction. `steady` controls the band for fast current; `direction` controls its arrows.
- Symbol styles: `ansi`, `iec` (`us` and `eu` remain aliases). Electron states: `on`, `off`; no argument toggles direction.
- Wheel modes: `zoom`, `auto`.

### Tabs, files and models

```text
tabs
tab <number>
close [number]
new
open [file]
recent [number]
save
save as
save as <name>
autosave [off|1m|5m|focus]
export <format>
spice
models [kind] [search]
models import
models import <url>
models check <name>
```

- `tabs` lists active and unsaved states. Numbers start at 1. `close` defaults to the active tab
  and retains the normal unsaved-change prompt. Switching tabs stops scope audio.
- `save` always writes `.nfg`. Export formats: `nfg` (NodeForge circuit file), `xml` (CircuitJS XML),
  `txt` (CircuitJS text; refused when the circuit's settings don't fit it), `spice`. `spice` prints the netlist.
- `autosave` shows or sets when circuits are saved by themselves: `off`, `1m` or `5m` after the last
  edit, or `focus` when the window loses focus. Desktop only; a circuit is autosaved once it has an
  `.nfg` file. It is the same preference as File › Autosave.
- `recent` lists File › Open recent, numbered from 1; `recent <number>` opens one (desktop).
- `open` without a file uses a picker; an argument may name a bundled circuit or a desktop path.
- Model kinds include diode, zener, nmos, pmos, njf, pjf, npn and pnp. `model PART NAME` takes the
  SPICE name or the name the Model list shows (`GEN_J310` or `J310`). Import without a URL uses a picker.

### Help

```text
about
version
changes
shortcuts
licenses
updates
```

- Each opens its Help item: About NodeForge, What's new…, Keyboard shortcuts…, Licenses… and Check for
  updates…. `version` prints the version. These are the shell's shared commands, the same in every Forge app.

### Tools and console

```text
bench [steps]
montecarlo [runs]
help [command]
help <command> <action>
clear
history
history <number>
history clear
undo
redo
```

- Bench defaults to 4000 steps; accepts 1–1000000, with a 10-second computation limit.
- Monte Carlo defaults to 20 runs; accepts 1–200. Both tools run on copies with a 120-second
  worker timeout. Ctrl+C cancels.
- A plain hyphen introduces displayed explanatory comments. Typed comment lines are not part of
  the command language.

## Platform limits

- Browser file access uses pickers and downloads. `open <name>` opens bundled circuits; paths need
  the desktop app. Browser downloads don't mark the document saved, since completion can't be
  confirmed.
- `accuracy check`, `compare` and `models check` need desktop ngspice; the browser says so without
  claiming a comparison ran. Unsupported SPICE parts are reported, never omitted.
- Browser model links need CORS permission from the server. Imports that replace existing names
  are reviewed in the Model Library dialog.
- File-valued part properties (audio and data inputs) use the inspector's picker. Library-model
  tolerances are limited to the parameters the engine supports.
- Some menu and inspector actions have no console command.
