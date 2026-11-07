// The Model library window: browse the models (built-in and the user's), import SPICE model files
// or a link to one, and check models against ngspice.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { createButton } from "forge-shell/app/builders";
import { setTip } from "forge-shell/app/tips";
import { desktop } from "./bridge";
import { checkPercent, displayName, findModels, KIND_LABELS, type LibraryModel, type ModelKind } from "./model-catalog";
import { MAKER_MODELS } from "./maker-models";
import { modelLibrary } from "./model-library";

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Models being checked against ngspice right now (by name). */
const checking = new Set<string>();

/** Check models against ngspice in the background (desktop), saving each result in the library. */
export async function checkModels(models: LibraryModel[], onDone: () => void): Promise<string | null> {
  if (!desktop) return "Model checks require ngspice in the desktop app.";
  const todo = models.filter((m) => !checking.has(m.name));
  if (!todo.length) return null;
  for (const m of todo) checking.add(m.name);
  onDone();
  try {
    const r = await desktop.models.check(JSON.stringify(todo));
    if ("error" in r) return /ngspice/i.test(r.error) ? r.error : `Couldn't check: ${r.error} (is ngspice installed?)`;
    const date = new Date().toISOString().slice(0, 10);
    for (const res of r.results) await modelLibrary.update(res.name, { check: { error: res.error, date, note: res.note } });
    return null;
  } catch (error) {
    return `Couldn't check: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    for (const m of todo) checking.delete(m.name);
    onDone();
  }
}

/** Open the Model library window. */
export function openModelLibrary(): void {
  const backdrop = h("div", "modal-backdrop");
  const box = h("div", "save-prompt models");
  box.setAttribute("role", "dialog");
  backdrop.append(box);
  const title = h("div", "title", "Model library");
  const status = h("div", "hint-text models-status");
  const body = h("div", "models-body");
  const close = () => {
    document.removeEventListener("keydown", keys, true);
    backdrop.remove();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const say = (text: string, warn = false) => {
    status.textContent = text;
    status.classList.toggle("warning-text", warn);
  };

  // MARK: the list

  let query = "";
  let kindFilter: ModelKind | "" = "";
  const showList = () => {
    body.replaceChildren();
    const bar = h("div", "models-bar");
    const search = h("input", "models-search");
    search.type = "search";
    search.placeholder = "Search models";
    setTip(search, "Search model names, manufacturers and specifications.");
    search.value = query;
    search.addEventListener("input", () => {
      query = search.value;
      renderRows();
    });
    const kind = h("select");
    for (const [v, t] of [["", "All kinds"], ...Object.entries(KIND_LABELS)] as [string, string][]) kind.append(new Option(t, v, false, v === kindFilter));
    kind.addEventListener("change", () => {
      kindFilter = kind.value as ModelKind | "";
      renderRows();
    });
    const importFile = createButton({ label: "Import file…" });
    importFile.addEventListener("click", () => void importFromFiles());
    const importLink = createButton({ label: "Import from link…" });
    importLink.addEventListener("click", () => showLinkRow());
    const makers = createButton({ label: "Makers' models…" });
    setTip(makers, "Manufacturers' SPICE models: import from their links, or open their pages.");
    makers.addEventListener("click", () => showMakers());
    bar.append(search, kind, importFile, importLink, makers);
    const table = h("div", "models-table");
    const renderRows = () => {
      table.replaceChildren();
      const q = query.trim().toLowerCase();
      const rows = modelLibrary.all.filter((m) => (!kindFilter || m.kind === kindFilter)
        && (!q || `${m.name} ${displayName(m)} ${m.manufacturer ?? ""} ${m.description ?? ""} ${Object.entries(m.specs).flat().join(" ")}`.toLowerCase().includes(q)));
      if (!rows.length) table.append(h("div", "muted models-empty", modelLibrary.all.length ? "No model matches." : "No models. Import a SPICE file (.lib, .mod or .spi)."));
      // by manufacturer (Generic first), then kind and name
      const manufacturer = (m: LibraryModel) => (m.manufacturer === "Generic" ? "" : m.manufacturer ?? "~");
      for (const m of rows.sort((a, b) => manufacturer(a).localeCompare(manufacturer(b)) || a.kind.localeCompare(b.kind) || displayName(a).localeCompare(displayName(b), undefined, { numeric: true }))) {
        const row = h("div", "models-row");
        const name = h("div", "models-name", displayName(m));
        setTip(name, `SPICE name: ${m.name}`);
        const what = h("div", "models-kind", [m.manufacturer, KIND_LABELS[m.kind]].filter(Boolean).join(", "));
        const specs = h("div", "models-specs", Object.entries(m.specs).map(([k, v]) => `${k} ${v}`).join("   "));
        if (m.description) setTip(specs, m.description);
        const check = h("div", "models-check");
        if (checking.has(m.name)) check.textContent = "checking…";
        else if (m.check?.error != null) {
          check.textContent = `±${checkPercent(m.check.error)} vs ngspice`;
          check.classList.toggle("warning-text", m.check.error > 1);
          setTip(check, `Checked ${m.check.date}: NodeForge and ngspice on the ${KIND_LABELS[m.kind].toLowerCase()} test circuit, worst difference in waveform shape${m.check.note ?? ""}`);
        } else if (m.check) {
          check.textContent = "not checked";
          setTip(check, m.check.note ?? "");
          check.classList.add("warning-text");
        }
        const actions = h("div", "models-actions");
        if (!m.builtIn && desktop) {
          const c = h("button", "link-button", "Check");
          setTip(c, "Compare this model with ngspice.");
          c.addEventListener("click", () => void checkModels([m], renderRows).then((err) => err && say(err, true)));
          actions.append(c);
        }
        if (!m.builtIn) {
          const del = h("button", "link-button", "Remove");
          del.addEventListener("click", () => void modelLibrary.remove(m.name).then(renderRows));
          actions.append(del);
        }
        const src = m.source ? h("div", "models-source", m.source) : null;
        row.append(name, what, specs, check, actions);
        if (src) row.append(src);
        table.append(row);
      }
    };
    renderRows();
    const linkRow = h("div", "models-link");
    linkRow.hidden = true;
    const showLinkRow = () => {
      linkRow.hidden = false;
      linkRow.replaceChildren();
      const url = h("input", "models-url");
      url.type = "url";
      url.placeholder = "SPICE model URL";
      const go = createButton({ label: "Download", primary: true });
      const run = async () => {
        const link = url.value.trim();
        if (!link) return;
        say("Downloading…");
        const got = await download(link);
        if ("error" in got) return say(got.error, true);
        say("");
        review([{ name: got.name, text: got.text, source: link }]);
      };
      go.addEventListener("click", () => void run());
      url.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          void run();
        }
      });
      linkRow.append(url, go);
      url.focus();
    };
    // manufacturers' models: links only (their terms don't let NodeForge ship them)
    const makersList = h("div", "models-table");
    makersList.hidden = true;
    const showMakers = () => {
      makersList.hidden = !makersList.hidden;
      makersList.replaceChildren();
      for (const m of MAKER_MODELS) {
        const row = h("div", "models-row");
        const name = h("div", "models-name", m.part);
        const what = h("div", "models-kind", [m.maker, m.kind ? KIND_LABELS[m.kind] : ""].filter(Boolean).join(", "));
        const specs = h("div", "models-specs", m.checked ?? "");
        setTip(specs, m.terms);
        const actions = h("div", "models-actions");
        if (m.file) {
          const imp = h("button", "link-button", "Import");
          setTip(imp, `Download ${m.file} and import it.`);
          imp.addEventListener("click", () => void (async () => {
            say("Downloading…");
            const got = await download(m.file!);
            if ("error" in got) return say(got.error, true);
            say("");
            review([{ name: got.name, text: got.text, source: m.file! }]);
          })());
          actions.append(imp);
        }
        const open = h("button", "link-button", "Open page");
        setTip(open, m.page);
        open.addEventListener("click", () => window.open(m.page, "_blank"));
        actions.append(open);
        row.append(name, what, specs, h("div", "models-check"), actions);
        row.append(h("div", "models-source", m.terms));
        makersList.append(row);
      }
    };
    body.append(bar, linkRow, makersList, table);
    search.focus();
  };

  // MARK: importing

  const importFromFiles = async () => {
    const files = desktop ? await desktop.models.openFiles() : await pickFiles();
    if (files.length) review(files.map((f) => ({ name: f.path.split(/[\\/]/).pop() ?? f.path, text: f.text, source: f.path.split(/[\\/]/).pop() })));
  };

  /** Show what files contain, to choose which models to add and as what. */
  const review = (files: { name: string; text: string; source?: string }[]) => {
    const found: { m: LibraryModel; take: boolean }[] = [];
    let skipped = 0;
    for (const f of files) {
      const r = findModels(f.text, f.source);
      skipped += r.skipped.length;
      for (const m of r.models) found.push({ m, take: true });
    }
    body.replaceChildren();
    if (!found.length) {
      say(`No supported SPICE models found in ${files.map((f) => f.name).join(", ")}.`, true);
      showList();
      return;
    }
    say(`${found.length} model${found.length === 1 ? "" : "s"} found${skipped ? ` (${skipped} line${skipped === 1 ? "" : "s"} not understood, ignored)` : ""}. Choose what to add:`);
    const table = h("div", "models-table");
    for (const item of found) {
      const row = h("label", "models-row review");
      const box = h("input");
      box.type = "checkbox";
      box.checked = true;
      box.addEventListener("change", () => (item.take = box.checked));
      const kind = h("select");
      for (const [v, t] of Object.entries(KIND_LABELS)) kind.append(new Option(t, v, false, v === item.m.kind));
      kind.addEventListener("change", () => (item.m.kind = kind.value as ModelKind));
      const existing = modelLibrary.find(item.m.name);
      const name = h("div", "models-name", item.m.name);
      const specs = h("div", "models-specs", [item.m.manufacturer, ...Object.entries(item.m.specs).map(([k, v]) => `${k} ${v}`)].filter(Boolean).join("   "));
      row.append(box, name, kind, specs);
      if (existing) row.append(h("div", "models-check warning-text", existing.builtIn ? "replaces built-in" : "replaces imported model"));
      table.append(row);
    }
    const actions = h("div", "actions");
    const back = createButton({ label: "Cancel" });
    back.addEventListener("click", () => {
      say("");
      showList();
    });
    const add = createButton({ label: "Add to library", primary: true });
    add.addEventListener("click", async () => {
      const chosen = found.filter((f) => f.take).map((f) => f.m);
      if (!chosen.length) return;
      await modelLibrary.add(chosen);
      showList();
      say(`Added ${chosen.length} model${chosen.length === 1 ? "" : "s"}.${desktop ? " Checking against ngspice…" : ""}`);
      if (desktop) {
        const err = await checkModels(chosen, () => showList());
        say(err ?? `Added ${chosen.length} model${chosen.length === 1 ? "" : "s"} and checked them against ngspice.`, !!err);
      }
    });
    actions.append(h("span", "spacer"), back, add);
    body.append(table, actions);
  };

  const done = createButton({ label: "Done", primary: true });
  done.addEventListener("click", close);
  const footer = h("div", "actions");
  const note = h("div", "hint-text models-note",
    "Imported models are stored in your library and circuit files. Check the model license before sharing.");
  footer.append(note, h("span", "spacer"), done);
  box.append(title, status, body, footer);
  document.addEventListener("keydown", keys, true);
  document.getElementById("overlay-root")!.append(backdrop);
  void modelLibrary.load().then(showList);
}

/** Download a model file: through the desktop app (no browser restrictions), or fetch on the web. */
async function download(url: string): Promise<{ text: string; name: string } | { error: string }> {
  if (desktop) return desktop.models.download(url);
  try {
    const r = await fetch(url);
    if (!r.ok) return { error: `The server answered ${r.status}` };
    return { text: await r.text(), name: new URL(url).pathname.split("/").pop() || url };
  } catch {
    return { error: "Download failed. Save the file locally, then choose Import file…" };
  }
}

/** The browser's file picker. */
function pickFiles(): Promise<{ path: string; text: string }[]> {
  return new Promise((resolve) => {
    const input = h("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".lib,.mod,.spi,.sp,.cir,.sub,.model,.txt,.inc,.ckt";
    input.addEventListener("change", async () => {
      const out: { path: string; text: string }[] = [];
      for (const f of input.files ?? []) out.push({ path: f.name, text: await f.text() });
      resolve(out);
    });
    input.click();
  });
}
