# Changelog

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
