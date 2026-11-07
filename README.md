# NodeForge

NodeForge is a circuit simulator for macOS, Windows and the browser. It began as a TypeScript port of [CircuitJS1](https://github.com/sharpie7/circuitjs1) by Paul Falstad and Iain Sharp. The port remains available as a compatibility mode, and a second engine adds error-controlled time steps, SPICE device models and circuit analyses. Results are compared with ngspice, which is installed separately and is not bundled.

## Capabilities

| Area | Content |
|---|---|
| Engines | CircuitJS mode reproduces CircuitJS1 step for step. The NodeForge engine, the default, controls the time step by its error estimate, places steps on source edges and solves with Newton iteration and a sparse factorization. |
| Device models | Diodes, Zener diodes and LEDs, MOSFET levels 1 to 3, VDMOS power MOSFETs, Gummel-Poon transistors and JFETs follow ngspice 47. Subcircuits with `.param` and `.func`, behavioral sources and coupled inductors are supported. |
| Temperature | Every circuit has a temperature. Diodes and power MOSFETs may heat themselves, with a heatsink per MOSFET. |
| Models | The library holds 85 generic models, and `.lib` or `.mod` files may be imported. |
| Analyses | Transient runs, DC operating points, DC sweeps, parameter sweeps, AC sweeps, Monte Carlo runs over component tolerances, a power report and recommended solver settings. |
| Scopes | Stacked scopes with triggers, box zoom, X-Y and FFT plots, measurements, cursors, trace math and sound. |
| Files | The native `.nfg` format, with import and export of CircuitJS text and XML. |
| Terminal | A command console for the same operations. The command `help` lists the commands. |

## Accuracy

The reference is ngspice, run on the same netlist. The device circuits agree within 0.01% of the swing of each node, with the exceptions recorded in `tests/checks.json`. The ZVS Mazzilli driver, the circuit for which NodeForge is built, agrees within 0.10% of the swing, the difference being a drift in phase.

## Installation

Each release carries two unsigned installers.

| Platform | File | Notes |
|---|---|---|
| macOS | `NodeForge-v<version>.dmg` | The first launch requires a right click and **Open**. |
| Windows x64 | `NodeForge-v<version>.exe` | The setup requests administrator rights and installs for all users in `C:\Program Files\Forge\NodeForge`. SmartScreen may require **More info** and **Run anyway**. |

The Windows installer is verified by automated checks and a launch screenshot and has not been tested by hand.

## Documentation

| Document | Content |
|---|---|
| [User guide](documentation/USER_GUIDE.md) | Files, editing, navigation, scopes and sound |
| [Console](documentation/CONSOLE.md) | The commands of Terminal |
| [File format](documentation/FILE_FORMAT.md) | The `.nfg` circuit file |
| [Architecture](documentation/ARCHITECTURE.md) | Engines and layout |
| [Development](documentation/DEVELOPMENT.md) | Building, checking and releasing |
| [Interface profile](documentation/INTERFACE.md) | The product and domain choices within the Forge guidelines |
| [Changelog](CHANGELOG.md) | The changes of each version |
| [Notice](NOTICE.md) | Borrowed work, licences and credits |

## Licence

NodeForge is licensed under the GNU General Public License, version 2 or, at the option of the user, any later version ([LICENSE](LICENSE)). Each build includes the licence texts and the corresponding source. [NOTICE.md](NOTICE.md) records the works from which NodeForge derives.
