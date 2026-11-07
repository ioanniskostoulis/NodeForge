# The .nfg file format

The `.nfg` file is the native circuit file of NodeForge: a JSON text document. It holds everything that a circuit has (parts, models, scopes, sliders and settings, including those of NodeForge) under names, so that a file reads on its own and differs line by line. CircuitJS `.txt` and `.xml` files are still opened. Circuits are saved as `.nfg`, and the CircuitJS formats are exports.

The format is implemented in `source/engine/circuitjs/io/nfg.ts`. `writeNfg` in `writer.ts` writes it, and `Circuit.parse` reads it and tells the formats apart by content and not by extension.

## Layout

```json
{
  "format": "nodeforge",
  "version": 1,
  "meta": { "title": "ZVS Mazzilli", "created": "…", "modified": "…", "app": "NodeForge 2.7.13" },
  "types": { "resistor": "r", "wire": "w", "mosfet": "f" },
  "engine": { "timeStep": 1e-7, "minTimeStep": 5e-14, "speed": 10, "solver": 0, "temperature": 25, "selfHeating": false, "startupRamp": 0, "tolerance": { "on": true, "seed": 3 } },
  "display": { "dots": true, "smallGrid": false, "voltage": true, "power": false, "values": true, "currentBar": 50, "powerBar": 50, "voltageRange": 5 },
  "models": [ { "type": "spice-model", "props": { "n": "GEN_IRFP250" }, "text": ".model GEN_IRFP250 VDMOS(…)" } ],
  "parts": [
    [128, 96, 160, 96],
    { "type": "resistor", "at": [160, 96, 160, 300], "props": { "flags": 0, "resistance": 470 } }
  ],
  "scopes": [ { "plots": [{ "part": 12, "value": 0 }], "speed": 64, "voltage": true, "current": false, "position": 0, "flags": 0 } ],
  "sliders": [ { "part": 4, "item": 0, "min": 1, "max": 1000, "label": "R1" } ]
}
```

| Key | Content |
|---|---|
| `meta` | What the file says about itself: `title`, `description`, `author`, `created`, `modified` and `app`. Free keys are kept. The application sets `created`, `modified` and `app` when it saves. |
| `types` | Each readable part type used in the file, mapped to the CircuitJS XML tag that it stands for. The reader follows this table, so a type name may change in a later build without breaking old files. A type absent from the table is taken as the tag itself. |
| `engine`, `display` | The settings of the circuit. Missing keys take their defaults. |
| `models` | Custom diode, MOSFET, transistor, relay, logic and subcircuit models, and the SPICE models of the NodeForge engine. They precede the parts that use them. |
| `parts` | One part per line, in the order of the circuit. `at` is the position (`x1, y1, x2, y2`), and `props` are the properties; a number is a number and anything else is text. The number of a part (0-based, in this order) is how scopes and sliders refer to it, so the order is part of the circuit. A plain wire is written as its position alone, `[x1, y1, x2, y2]`. `children` and `text` hold what some parts nest, such as the pins of a subcircuit or the card of a model. |
| `scopes`, `sliders` | Scopes (traces by part number and value, trigger, math and expression traces, measurements and view) and sliders (the property of a part, range, logarithmic scale, step and the slider that it follows). |

The properties of the common parts (resistor, capacitor, inductor and the sources) have readable names. The other parts keep their CircuitJS names, and a readable name can be added later without a new version of the file.

## Behaviour of a reader and a writer

| Property | Statement |
|---|---|
| Order and layout | They are fixed, so the same circuit always gives the same text, and files differ and merge with Git. |
| Unknown keys | Top-level keys that the build does not know are written back unchanged. A file with a newer `version` opens, with the known part read and a note logged, and is saved as the version of this build. |
| Derived data | Voltages, currents and scope samples are not saved; opening a file always computes them again. |
| Equality with XML | An `.nfg` file is the XML form of the circuit in named fields. `tests/nfg-format.mjs` writes every sample circuit as `.nfg`, reads it back and checks that its XML is byte-identical, so CircuitJS mode remains bit-exact. |

## Saving and opening

| Subject | Behaviour |
|---|---|
| Save and Save as | They always write `.nfg`. A circuit opened from CircuitJS `.txt` or `.xml` is saved beside it as `.nfg`, and the original is left unchanged. The browser version downloads `.nfg`. |
| Export | File › Export as, or the console, writes a copy: `export xml` and `export txt` for CircuitJS (`export txt` refuses a circuit whose settings the text format cannot keep), `export spice` for an ngspice netlist and `export nfg` for an `.nfg` copy without changing the file of the circuit. |
| `nfsim` | `nfsim nfg <file>` prints a circuit as `.nfg`, and `nfsim roundtrip` and `nfsim bench` accept `.nfg` files. |
| Registration | The desktop application registers `.nfg`: on macOS Finder opens it in NodeForge with the icon `assets/icon/nfg.icns`, and on Windows the icon is `assets/icon/nfg.ico`. `scripts/file-icon.py` draws the icons from `assets/icon.png`. |

## Excluded from version 1

Readable property names for every part, wires merged into polylines (which would change the part numbers), a thumbnail, saved scope recordings, saved sweep definitions and parameter variants, reusable blocks as files, and a bundle of models and results. Each fits into this layout without a break, and the roadmap lists them.
