# User guide

## Files and tabs

NodeForge opens on a welcome screen with New and Open. Circuits open as tabs of one window. Files opened from Finder, or by a second launch, become tabs.

| Action | Shortcut | Behaviour |
|---|---|---|
| New | ⌘N | Creates `Untitled n`, with the lowest number not used by an open tab |
| Open | ⌘O | Opens `.nfg`, CircuitJS text and CircuitJS XML; a sole untouched blank tab is replaced |
| Drop | Drag files onto the sheet | Opens dropped `.nfg`, `.txt`, `.xml` and `.circuitjs` files as tabs; other files are refused in Messages |
| Save | ⌘S | Writes a `.nfg` file ([FILE_FORMAT.md](FILE_FORMAT.md)); a circuit opened from `.txt` or `.xml` is saved beside it as `.nfg` |
| Close | ⌘W | Closes the tab; a circuit with unsaved edits offers Save, Discard and Cancel |
| Next tab | ⌃Tab | Selects the next tab |
| Export | File › Export as | Writes CircuitJS XML or text, an `.nfg` copy or a SPICE netlist |
| Example | File › Open example | Lists the 373 circuits of the CircuitJS library |
| Open recent | File › Open recent | The last ten circuit files opened or saved, with Clear menu (desktop) |
| Autosave | File › Autosave | Off, after 1 or 5 minutes, or when the window loses focus; only a circuit that has an `.nfg` file is saved (desktop) |

When NodeForge quits unexpectedly with unsaved edits, the next launch lists those circuits and Restore reopens the ticked ones, still marked unsaved. Cancel keeps them for the next launch. Closing a window normally, after its circuits were saved or discarded, keeps nothing.

An unsaved circuit is renamed in the Name row of the inspector, by a double click or by F2. The name becomes the one offered by the first Save. A saved circuit takes the name of its file, and Save as gives it another.

## Editing

| Subject | Behaviour |
|---|---|
| Placing | A part is chosen in the tool strip, in the Draw menu or by its key: `w` wire, `r` resistor, `c` capacitor, `L` inductor, `g` ground, `v` source, `s` switch, `d` diode, `z` Zener diode, `f` or `F` MOSFET. A drag on the sheet sets its size, and a click gives the default size. Esc returns to Select. |
| Selecting and moving | A click selects and ⇧ adds. A drag on empty space selects an area, a drag on a part moves it and a drag on the end of a wire reshapes it. |
| Edit keys | ⌫ deletes. ⌘C, ⌘X, ⌘V and ⌘D copy, cut, paste and duplicate. ⇧⌘R and ⇧⌘L rotate clockwise and counterclockwise. The arrow keys nudge. ⌘Z and ⇧⌘Z undo and redo. |
| Properties | A double click on a part, or ⌘I, shows its properties in the inspector. Values take SI prefixes (`4.7k`, `10u`, `1M`) and are shown with their unit (`4.7 kΩ`). An invalid value is reported in the status bar and in Messages, and the field returns to its last valid value. |
| Inspector sections | Each section folds from its heading, and an ⌥ click folds all of them. |
| Self-heating | Circuit › Self-heating heats the diodes and power MOSFETs whose models carry thermal values. Each glows in the colour of its junction temperature (ice blue at 0 °C, green at 25 °C, yellow at 85 °C and red at 150 °C), and its readout and scopes give Tj. The Heatsink property of a MOSFET sets its heatsink in °C/W. |

### Messages

The Messages tab logs what the application reported about the active circuit: load warnings, unsupported parts, model problems, a stopped simulation, failed analyses and saves, and results such as Saved. Each circuit keeps its own log of the last 500 entries, which is not saved. A part named in an entry is selected when the name is clicked. The count beside the warning icon in the status bar counts the problems logged since the tab was last shown, and Clear empties the log.

## Navigation

Navigation is the same on the schematic and in the scopes.

| Input | Action |
|---|---|
| Two-finger scroll | Pans |
| Pinch or ⌘ scroll | Zooms |
| Mouse wheel | Zooms at the pointer; View › Scroll wheel always zooms selects the behaviour |
| ⇧ wheel | Pans sideways |
| Middle drag or space drag | Pans |
| Space tap or double click | Fits the schematic, or returns the scope under the pointer to live with every axis automatic |
| ⌘↩ | Runs or pauses |

## Scopes

| Subject | Behaviour |
|---|---|
| Adding | A right click on a part offers View in Scope and Add to Scope N. Each part offers its own quantities: voltage, current and power; Vbe, Vbc, Vce, Ib, Ic and Ie on a transistor; Vds, Id, Vgs and the gate current on a MOSFET; resistance on lamps, memristors and ohmmeters; charge on capacitors. |
| Header tiles | Trigger (with Live and dB), Sound and Auto switch on and off and are blue when on. A right click on a tile opens its options. The plot label (time per division, FFT or X-Y) switches between Time, X-Y and FFT. |
| Navigation | A drag draws a box to zoom into. Scrolling, middle drag and space drag move; pinch, ⌘ scroll and the wheel zoom, and ⌥ scroll zooms values. Over an axis the movement or zoom affects that axis only, and a click opens its scale. A live plot stays live when zoomed, and moving away leaves live; Live returns. Navigation switches Auto off. Space, a double click or Fit fits the plot, and Zoom back undoes one step. |
| Spectrum | The window is Hann, flat-top or rectangular. Harmonics 2 to 10 are marked, the THD is shown in the legend and the frequency axis is logarithmic. |
| X-Y | X-Y axes chooses the trace of each axis and a long trail. The plot list also offers the V–I curve. |
| Traces | A click on a trace in the legend opens its menu: trigger on it, listen to it, or make a math trace (sum, difference, product or quotient with another trace, integral or derivative). Math traces are saved and have their own Remove. |
| Measurements | Peak, minimum, peak-to-peak, average, RMS and overshoot; frequency, period, duty cycle, pulse width, rise and fall time (10% to 90%) and phase to the first trace; energy, energy per cycle and efficiency to the first power trace. The values describe the visible data. A click places cursor A, a second click places B, and a third moves the nearer. With both placed, the measurements cover the stretch between them. |
| Arrangement | A drag of the header of a scope moves it. A drop near the left or right edge of another scope makes a separate column, and a drop on the upper or lower half stacks. Esc, or a release outside the panel, cancels. A move keeps recordings and audio choices, can be undone and is saved. Column dividers resize side-by-side scopes, and a double click gives equal widths. |
| Sweeps | `dcsweep`, `stepsweep` (runs overlaid) and `ac` (Bode plot) open a scope with the result. A sweep scope is not saved. Run and Reset run it again on the circuit as it is. DC sweep… and AC sweep… on a source write the command for editing. |
| Persistence | Scope settings, views and triggers are saved with the circuit. |

## Scope audio

A click on the speaker switches sound on or off and resumes the last trace and mode of the scope; the first use plays the first visible trace as a waveform. A right click chooses Off, Map value to pitch or Play operating waveform, then On V, On I or On P for the visible traces.

| Subject | Behaviour |
|---|---|
| Map value to pitch | Values are mapped to pitch by the vertical scale at the start of listening. |
| Play operating waveform | The DC component is removed and the level is set for the speaker. The pitch follows simulation progress: a 239 Hz waveform sounds at 239 Hz at 1× and at 23.9 Hz at 0.1×, provided that the solver reaches that speed. Content above hearing at that speed is filtered out and not folded down. |
| Listen at real-time speed | Repeats a whole number of periods without a seam. |
| Playback | One trace and one mode play at a time, with about 120 ms from circuit to speaker. Playback pauses with the simulation, and a reset clears old audio. Hiding the playing trace switches to a remaining visible one, or stops the audio. |
| Persistence | Audio choices are not saved with the circuit. A browser requires a user action first, such as a click on the speaker, a choice of an option or an audio command. |

## Updates

Help › Check for updates… compares this version with the latest release on GitHub. On the desktop, Update and restart downloads the release's installer, checks its size and checksum, installs it and restarts NodeForge. On macOS NodeForge replaces itself when it runs from a folder it can write, such as Applications; otherwise the disk image opens to drag it in. On Windows the setup runs silently and asks for administrator rights once. In the browser the release page is offered. At most once a day, at launch, a newer release is noted in Messages.

## Terminal

The Terminal tab is the command console of NodeForge and not an operating-system shell. The command `help` lists the commands, which [CONSOLE.md](CONSOLE.md) describes. Checks against ngspice require the desktop application.
