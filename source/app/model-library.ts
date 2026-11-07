// The model library as the app holds it: the built-in models (public/models.json) and the user's
// own (a file in the app's data folder on the desktop, browser storage on the web). Every model is
// registered with the engine, so parts can use it by name.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { DiodeModel, defineModels, diodeCard, findModel, jfetCard, modelText, MosfetModel, parseSpice, type SpiceModel, type SpiceModelKind, TransistorModel, transistorCard, tunableMosfetCard } from "../engine";
import { desktop } from "./bridge";
import { circuitJSLabel, findModels, kindsForPart, type LibraryModel, type ModelKind, modelSpecs } from "./model-catalog";

const STORAGE_KEY = "nodeforge-models";

class ModelLibrary {
  private builtIn: LibraryModel[] = [];
  private user: LibraryModel[] = [];
  private listeners: (() => void)[] = [];
  private loading: Promise<void> | null = null;
  private thermalDefaults = new Map<string, SpiceModel>();

  /** Load both libraries (once; later calls wait for the first). */
  load(): Promise<void> {
    return (this.loading ??= (async () => {
      try {
        const r = await fetch("models.json");
        // NodeForge's own models: under Generic
        if (r.ok) this.builtIn = ((await r.json()) as LibraryModel[]).map((m) => ({ ...m, manufacturer: m.manufacturer ?? "Generic", builtIn: true }));
      } catch {
        // no built-in models (an old build)
      }
      try {
        const text = desktop ? await desktop.models.load() : localStorageGet(STORAGE_KEY);
        if (text) this.user = (JSON.parse(text) as LibraryModel[]).filter((m) => m && m.name && m.spice);
      } catch {
        this.user = [];
      }
      for (const m of this.builtIn) {
        if (!/^GEN_/i.test(m.name) || this.isUser(m.name)) continue;
        const card = parseSpice(m.spice).models.get(m.name.toLowerCase());
        if (card?.type === "VDMOS" && card.params.has("rthjc")) this.thermalDefaults.set(m.name.toLowerCase(), card);
      }
      // A circuit may have opened before this asynchronous load. Its saved electrical model
      // wins over the library; only missing thermal data in older Generic cards is filled in.
      for (const m of [...this.user, ...this.builtIn]) if (!findModel(m.name)) defineModels(m.spice);
      this.upgradeLegacyThermalModels(this.thermalDefaults.keys());
      this.changed();
    })());
  }

  /** Older built-in VDMOS cards predate heatsinks. Keep their electrical values and any thermal
   * values already supplied, adding only the missing thermal parameters from the same model. */
  upgradeLegacyThermalModels(names: Iterable<string>): void {
    for (const name of new Set(names)) {
      const defaults = this.thermalDefaults.get(name.toLowerCase());
      const def = findModel(name);
      const saved = def?.model;
      if (!defaults || this.isUser(name) || !def || saved?.type !== "VDMOS" || saved.params.has("rthjc")) continue;
      const additions: string[] = [];
      for (const key of ["rthjc", "rthca", "cthj"]) {
        const value = defaults.params.get(key);
        if (!saved.params.has(key) && value !== undefined) additions.push(`${key}=${value}`);
      }
      // Preserve original tokens and expressions, including their exact numeric precision.
      const source = saved.source.trimEnd();
      const upgraded = source.endsWith(")")
        ? `${source.slice(0, -1)} ${additions.join(" ")})`
        : `${source} ${additions.join(" ")}`;
      defineModels(def.text.replace(saved.source, () => upgraded));
    }
  }

  /** Every model, the user's first (theirs win over a built-in of the same name). */
  get all(): LibraryModel[] {
    const names = new Set(this.user.map((m) => m.name.toLowerCase()));
    return [...this.user, ...this.builtIn.filter((m) => !names.has(m.name.toLowerCase()))];
  }

  /** Models for a kind of part: diodes and zeners for a diode, n or p MOSFETs for a MOSFET, and so on. */
  forPart(kind: SpiceModelKind, pnp = 1): LibraryModel[] {
    const kinds = kindsForPart(kind, pnp);
    return this.all.filter((m) => kinds.includes(m.kind)).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * CircuitJS's own models (built in, and any the open circuits define), as library entries with
   * their SPICE equivalents: diodes and zeners, or MOSFETs, JFETs or transistors of one polarity.
   */
  circuitJS(kind: SpiceModelKind, pnp = 1): LibraryModel[] {
    const entry = (name: string, label: string, k: ModelKind, card: ReturnType<typeof diodeCard>, builtIn: boolean, description: string | null): LibraryModel => ({
      name, label, kind: k, manufacturer: "CircuitJS", description: description && description !== name ? description : undefined, specs: modelSpecs(card),
      spice: card.source, builtIn, circuitJS: true,
    });
    if (kind === "diode") {
      return DiodeModel.getModelList(false).map((m) => entry(m.name, circuitJSLabel(m.name, m, "diode"), m.breakdownVoltage > 0 ? "zener" : "diode", diodeCard(m), m.builtIn, m.description));
    }
    if (kind === "bjt") {
      // BF as CircuitJS's default β (a part on the model uses its own)
      return TransistorModel.getModelList().map((m) => entry(m.name, circuitJSLabel(m.name, null, "bjt"), pnp > 0 ? "npn" : "pnp", transistorCard(m, pnp, 100), m.builtIn, m.description));
    }
    if (kind === "jfet") {
      return MosfetModel.getModelList(true).map((m) => entry(m.name, circuitJSLabel(m.name, m, "mosfet"), pnp > 0 ? "njf" : "pjf", jfetCard(m, pnp), m.builtIn, m.description));
    }
    // as a stand-alone card (what a custom model starts from); the part itself runs the exact equivalent
    return MosfetModel.getModelList(false).map((m) => entry(m.name, circuitJSLabel(m.name, m, "mosfet"), pnp > 0 ? "nmos" : "pmos", tunableMosfetCard(m, pnp), m.builtIn, m.description));
  }

  find(name: string): LibraryModel | null {
    return this.all.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  /** A model by name: the library's, or one a circuit defines (described from its SPICE text). */
  describe(name: string): LibraryModel | null {
    const lm = this.find(name);
    if (lm) return lm;
    const def = findModel(name);
    return def ? (findModels(def.text).models.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null) : null;
  }

  /** Add (or replace, by name) models in the user's library. */
  async add(models: LibraryModel[]): Promise<void> {
    for (const m of models) {
      this.user = this.user.filter((x) => x.name.toLowerCase() !== m.name.toLowerCase());
      this.user.push({ ...m, builtIn: undefined });
      defineModels(m.spice);
    }
    await this.save();
  }

  /** Update one of the user's models (its check result, kind, description). */
  async update(name: string, change: Partial<LibraryModel>): Promise<void> {
    const m = this.user.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!m) return;
    Object.assign(m, change);
    await this.save();
  }

  async remove(name: string): Promise<void> {
    this.user = this.user.filter((x) => x.name.toLowerCase() !== name.toLowerCase());
    await this.save();
  }

  isUser(name: string): boolean {
    return this.user.some((x) => x.name.toLowerCase() === name.toLowerCase());
  }

  private async save(): Promise<void> {
    const json = JSON.stringify(this.user, null, 1);
    if (desktop) await desktop.models.save(json);
    else localStorageSet(STORAGE_KEY, json);
    this.changed();
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}

function localStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private window): the library lasts this session only
  }
}

export const modelLibrary = new ModelLibrary();

/**
 * Save a part's custom model (its card) to the user's library under a name of its own; a model of
 * theirs with that name is replaced, a built-in one isn't. Returns why it couldn't be, or null.
 */
export async function saveCustomModel(card: SpiceModel, name: string): Promise<string | null> {
  if (!/^[A-Za-z][\w.+-]*$/.test(name)) return "Use a name of letters, digits and _ . + -, starting with a letter.";
  if (/^custom_/i.test(name)) return "Names starting with custom_ are kept for a part's own model.";
  if (modelLibrary.find(name) && !modelLibrary.isUser(name)) return `${name} is a built-in model. Choose another name.`;
  const { models } = findModels(modelText(card, name), "Saved from a custom model");
  if (!models.length) return "This kind of model can't go in the library.";
  await modelLibrary.add(models);
  return null;
}
