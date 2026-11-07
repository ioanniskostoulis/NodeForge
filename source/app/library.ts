// Licensed under the GNU General Public License v2 or later. See LICENSE.

/** One entry of the CircuitJS circuit list (setuplist.txt): a folder or a circuit file. */
export interface LibraryEntry {
  title: string;
  file: string | null;
  children: LibraryEntry[];
}

export interface Library {
  root: LibraryEntry[];
  /** The circuit CircuitJS opens at launch (marked with ">" in setuplist.txt). */
  startupFile: string | null;
  titles: Map<string, string>;
}

/** Parse setuplist.txt: "+Folder" opens a folder, "-" closes it, "file.txt Title" is a circuit. */
export function parseLibrary(list: string): Library {
  const stack: LibraryEntry[][] = [[]];
  const names: string[] = [];
  const titles = new Map<string, string>();
  let startupFile: string | null = null;
  for (const raw of list.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("+")) {
      names.push(line.slice(1));
      stack.push([]);
    } else if (line.startsWith("-")) {
      if (stack.length < 2) continue;
      const children = stack.pop()!;
      stack[stack.length - 1].push({ title: names.pop()!, file: null, children });
    } else {
      if (line.startsWith(">")) {
        line = line.slice(1);
        startupFile = line.split(" ")[0];
      }
      const space = line.indexOf(" ");
      if (space < 0) continue;
      const file = line.slice(0, space), title = line.slice(space + 1);
      stack[stack.length - 1].push({ title, file, children: [] });
      titles.set(file, title);
    }
  }
  return { root: stack[0], startupFile, titles };
}

/** The CircuitJS Draw menu tree (public/drawmenu.json, extracted from upstream Menus.java). */
export interface DrawItem {
  label: string;
  class?: string;
  items?: DrawItem[];
}

/** Names kept capitalized when a Draw label is put in sentence case. */
const PROPER = new Set(["Darlington", "Norton", "Zener", "Schmitt", "Hi"]);

/**
 * A Draw-menu label as NodeForge shows it (menus, toolbar, status): without CircuitJS's "Add", in
 * sentence case, acronyms and names kept ("Add Voltage Source (2-terminal)" → "Voltage source
 * (2-terminal)", "Add Darlington Pair (NPN)" → "Darlington pair (NPN)").
 */
export function drawLabel(raw: string): string {
  return raw.replace(/^Add /, "").replace(/[A-Za-z]+/g, (word, at: number) => (at > 0 && /^[A-Z][a-z]+$/.test(word) && !PROPER.has(word) ? word.toLowerCase() : word));
}

export async function loadText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`can't load ${url}: ${response.status}`);
  return response.text();
}
