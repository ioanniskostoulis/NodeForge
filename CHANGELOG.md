# Changelog

## 2.9.0

- Settings… (Cmd+, or `settings`) opens the shared Settings dialog with General, Terminal, Health and Updates. Updates are offered only in Settings › Updates; Help › Check for updates… is gone.
- Settings › Health and `health reminder` record active use and offer a daily break reminder.
- The Terminal keeps its own preferences under `terminal` (font, banner, caret, spacing, wrap), shown in Settings › Terminal; the bare `font` and `fit` commands are gone (`terminal font`, `zoom fit`).
- Every choice in the inspector (solver, relative tolerance, model, slider property) and in the Model library uses the shared drawn select instead of the system's list. The Model list separates its makers with a line.
- The part flyouts in the toolbar keep each symbol in its own column, so a switch or fuse no longer runs into its name.
- Exports other than a circuit file go through the shared export dialog, which asks before replacing a file and never overwrites an open circuit.
- Fit frames the selection, or the whole circuit when nothing is selected; the toolbar has Zoom out before Zoom in.
- The panes use the shared overlay scrollbars.
- The interface uses forge-shell 4.5.1.

## 2.7.5

- The inspector is grouped by subject again: Simulation opens it with Run or Pause, Reset and Step, then simulation speed, current marker speed and electron flow. Circuit holds the name, time, solver, relative tolerance, temperature, self-heating, the start-up ramp, the time step, Recommend settings… and the part count. The Settings section is gone.
- The interface uses forge-shell 4.0.0.

## 2.7.4

- The inspector opens with Circuit: Run or Pause, Reset and Step, then the circuit's name, time and part count. Simulation follows with Recommend settings…, speed, temperature, self-heating, the start-up ramp and the time step.
- The app settings (solver, relative tolerance, current marker speed and electron flow) move to a Settings section at the end of the inspector, shown while no part is selected.
- Pause has its own icon, and the icons are Lucide's, at the size of the previous set.
- The interface uses forge-shell 3.4.0: Cmd or Ctrl with the mouse wheel zooms 1.15× per notch, a cancelled splitter drag stops following the pointer, and the find bar keeps the match under the cursor.

## 2.7.1

- Circuit files dragged from Finder or File Explorer onto the sheet open as tabs, as File › Open does: `.nfg`, CircuitJS text and CircuitJS XML. Other files are refused with a note in Messages and the status bar.
- The interface uses forge-shell 3.1.1: option chips look like a button group, a disabled primary button keeps a legible label, panel buttons show a keyboard focus ring, and editable readouts end their tooltips with a period.

## 2.7.0

- NodeForge simulates circuits on macOS, Windows and in the browser with two engines: CircuitJS mode reproduces CircuitJS1 step for step, and the NodeForge engine, the default, controls each time step by its error estimate, places steps on source edges and solves with Newton iteration and a sparse factorization.
- Diodes, Zener diodes and LEDs, MOSFET levels 1 to 3, VDMOS power MOSFETs, Gummel-Poon transistors and JFETs follow the device equations of ngspice 47, with subcircuits, `.param` and `.func`, behavioral sources and coupled inductors. Results are compared with ngspice, which is installed separately.
- Every circuit has a temperature; diodes and power MOSFETs can heat themselves, with a heatsink per MOSFET, and junction temperatures can be plotted.
- Each part has one model, chosen from a library of 85 generic models and the makers' models, or a custom model whose parameters are edited in the inspector; `.lib` and `.mod` files can be imported.
- Transient runs, DC operating points, DC sweeps, parameter sweeps, AC sweeps with Bode plots, Monte Carlo runs over component tolerances, a power report with losses and efficiency, and recommended solver settings.
- Scopes stack and arrange by dragging, with triggers, box zoom, X-Y and FFT plots, measurements, cursors, trace math, CSV export and sound.
- Circuits are saved as `.nfg` files, and CircuitJS text and XML files open and export unchanged. The library of 373 example circuits opens from File › Open example.
- File › Open recent lists the last ten circuits, File › Autosave saves circuits after 1 or 5 minutes or when the window loses focus, and circuits left unsaved by a crash are offered again at the next launch.
- Help › Check for updates… finds a newer release and, on the desktop, installs it and restarts with **Update and restart**; once a day at launch a newer release is noted in Messages.
- The menus and keys follow the Forge standard: Fit is Cmd+0 and Actual size Cmd+1, Rotate clockwise and counterclockwise are Shift+Cmd+R and Shift+Cmd+L, and Step is Shift+Cmd+T. On Windows, Ctrl takes the place of Cmd.
- The Terminal runs every operation by command, including the shared Forge commands `recent`, `font`, `zoom in|out|fit|actual`, `about`, `version`, `changes`, `shortcuts`, `licenses` and `updates`; `help` lists them all.
- On the sheet, Shift adds parts to the selection, Cmd or Ctrl toggles them, and a plain click or box replaces it; a drag starts after 5 px. Circuit tabs can be dragged to rearrange them.
- The interface has Dark and Light appearances, an inspector and a bottom panel that close when dragged past their size, and a Messages log for problems with the circuit.
- The macOS disk image and the Windows setup are unsigned; on macOS the first launch requires a right click and **Open**, and the Windows setup installs for all users.
