// NodeForge — circuit simulator engine (no DOM, no Node APIs: runs in the browser, Electron and Node).
// Two engines:
//  - circuitjs/: the port of CircuitJS1 (parts, files, the fixed-step MNA simulator). Behaves
//    exactly like CircuitJS; the NodeForge engine builds on it.
//  - nodeforge/: the NodeForge engine (error-controlled steps, SPICE-style Newton, sparse
//    LU, DC operating point, diagnostics) and the ngspice export it's measured against.
// `Simulator` here is the NodeForge engine's, which runs as CircuitJS while `accurate` is off.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

export { CircuitElm, type PartSlider, ScopeValue } from "./circuitjs/core/elm";
export { Simulator as CircuitJSSimulator, SolverType } from "./circuitjs/core/simulator";
export { AccurateSimulator as Simulator, type PartStats, type SolverDiagnostics } from "./nodeforge/simulator";
export { SparseLU } from "./nodeforge/sparse";
export { hasThermalModel, ignoredParams, isSpicePart, junctionTemperature, partClassName, spiceModelKind, type SpiceModelKind, spiceModelOf, spicePolarity, withSpiceModel } from "./nodeforge/extensions";
export { diodeCard, jfetCard, mosfetCard, transistorCard, tunableMosfetCard } from "./nodeforge/spice/circuitjs";
export { SpiceDiodeElm, SpiceZenerElm } from "./nodeforge/elements/spice-diode";
export { SpiceMosfetElm } from "./nodeforge/elements/spice-mosfet";
export { defineModels, findModel, knownModels, type ModelDef } from "./nodeforge/spice/registry";
export { isNumber, modelText, parseModel, parseSpice, spiceNumber, type SpiceLibrary, type SpiceModel, type SpiceSubckt } from "./nodeforge/spice/parse";
export { hasExpressions, libraryScope, resolveModel } from "./nodeforge/spice/params";
export type { GridPoint, GridRect } from "./circuitjs/core/geometry";
export { grid, pointKey, samePoint, snapGrid, SYMBOL_FLIP_X, SYMBOL_FLIP_Y, SYMBOL_SWAP_XY } from "./circuitjs/core/geometry";
export { editItem, setEditValue, setWaveform, type EditItem } from "./circuitjs/core/edititems";
export { type EditInfo, type EditInput, numberInput } from "./circuitjs/core/editinfo";
export { editInfos, getEditInfo, setEditValue as setEditInput } from "./circuitjs/elements/edits";
export { CurrentElm, FuseElm, GroundElm, PlaceholderElm, ResistorElm, SwitchElm, WireElm } from "./circuitjs/elements/basic";
export { Diode, DiodeElm, DiodeModel, ZenerElm } from "./circuitjs/elements/diode";
export { MosfetElm, MosfetModel, NMosfetElm, PMosfetElm } from "./circuitjs/elements/mosfet";
export { CapacitorElm, InductorElm } from "./circuitjs/elements/reactive";
export * from "./circuitjs/elements/sources";
export { CCCSElm, CCVSElm, VCCSElm, VCVSElm } from "./circuitjs/elements/controlled";
export * from "./circuitjs/elements/analog";
export * from "./circuitjs/elements/annotations";
export * from "./circuitjs/elements/bus";
export * from "./circuitjs/elements/chips";
export * from "./circuitjs/elements/composite";
export * from "./circuitjs/elements/compositeparts";
export * from "./circuitjs/elements/customlogic";
export * from "./circuitjs/elements/logic";
export * from "./circuitjs/elements/more";
export * from "./circuitjs/elements/motors";
export * from "./circuitjs/elements/meters";
export * from "./circuitjs/elements/extras";
export * from "./circuitjs/elements/relays";
export * from "./circuitjs/elements/semis";
export { Expr, ExprParser, ExprState } from "./circuitjs/core/expr";
export {
  Circuit, adjustablePosition, adjustableValue, ScopeFlag, visiblePlots,
  type Adjustable, type CircuitOptions, type ScopePlotSpec, type ScopeSpec,
} from "./circuitjs/io/circuit";
export { classForName, constructElement, createNew, partClass, portedClassNames, newElementClasses, type ElmClass } from "./circuitjs/io/registry";
export { chooseFormat, isLossless, scopeElmSpec, setScopeElmSpec, writeCircuit, writeNfg, writeText, writeXml, type CircuitFormat } from "./circuitjs/io/writer";
export { toSpice, type SpiceNetlist } from "./nodeforge/spice";
export { runRegression, type RegressionResult } from "./circuitjs/testing/regression";
