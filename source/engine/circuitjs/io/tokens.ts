// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Parsing helpers matching the behavior CircuitJS1 relies on from java.util.StringTokenizer and
// XMLDeserializer. Licensed under the GNU General Public License v2 or later. See LICENSE.

export class CircuitParseError extends Error {}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Java number parsing semantics used by the text format. */
export const JavaNumber = {
  parseDouble(s: string): number {
    let t = s.trim();
    if (t.length > 1 && /[dDfF]$/.test(t)) t = t.slice(0, -1);
    if (t === "Infinity" || t === "+Infinity") return Infinity;
    if (t === "-Infinity") return -Infinity;
    if (t === "NaN") return NaN;
    if (!NUMBER.test(t)) throw new CircuitParseError(`bad number '${s}'`);
    return Number(t);
  },

  parseInt(s: string, radix = 10): number {
    const ok = radix === 16 ? /^[+-]?[0-9a-fA-F]+$/ : /^[+-]?\d+$/;
    if (!ok.test(s)) throw new CircuitParseError(`bad number '${s}'`);
    return parseInt(s, radix);
  },

  parseBool(s: string): boolean {
    return s.toLowerCase() === "true";
  },
};

/**
 * Equivalent of `new StringTokenizer(line, " +\t\n\r\f")`. Note that '+' is a delimiter in the
 * legacy text format (a leftover from URL encoding), so it never appears inside tokens.
 */
export class TokenStream {
  private readonly tokens: string[];
  private pos = 0;

  /** `delimiters` matches runs of delimiter characters (StringTokenizer's delimiter set). */
  constructor(line: string, delimiters: RegExp = /[ +\t\n\r\f]+/) {
    this.tokens = line.split(delimiters).filter((t) => t.length > 0);
  }

  get hasMoreTokens(): boolean {
    return this.pos < this.tokens.length;
  }

  next(): string {
    if (this.pos >= this.tokens.length) throw new CircuitParseError("missing token");
    return this.tokens[this.pos++];
  }

  nextDouble(): number {
    return JavaNumber.parseDouble(this.next());
  }

  nextInt(): number {
    return JavaNumber.parseInt(this.next());
  }

  nextBool(): boolean {
    return JavaNumber.parseBool(this.next());
  }

  /** Optional field: the parsed value, or undefined (consuming nothing) if absent or malformed. */
  tryDouble(): number | undefined {
    if (!this.hasMoreTokens) return undefined;
    try {
      const v = JavaNumber.parseDouble(this.tokens[this.pos]);
      this.pos++;
      return v;
    } catch {
      return undefined;
    }
  }

  tryInt(): number | undefined {
    if (!this.hasMoreTokens) return undefined;
    try {
      const v = JavaNumber.parseInt(this.tokens[this.pos]);
      this.pos++;
      return v;
    } catch {
      return undefined;
    }
  }
}

/** One XML element: tag, attributes, text content and children. */
export class XmlNode {
  text = "";
  children: XmlNode[] = [];

  constructor(public readonly tag: string, public readonly attributes: Record<string, string>) {}

  get(name: string): string | undefined {
    return this.attributes[name];
  }

  double(name: string, def: number): number {
    const v = this.attributes[name];
    return v === undefined ? def : JavaNumber.parseDouble(v);
  }

  int(name: string, def: number): number {
    const v = this.attributes[name];
    return v === undefined ? def : JavaNumber.parseInt(v);
  }

  bool(name: string, def: boolean): boolean {
    const v = this.attributes[name];
    return v === undefined ? def : JavaNumber.parseBool(v);
  }

  string(name: string, def: string | null): string | null {
    return this.attributes[name] ?? def;
  }
}

const ENTITIES: Record<string, string> = { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|quot|apos|lt|gt|amp);/g, (_, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e];
  });
}

/**
 * Minimal XML parser for circuit files (elements, attributes, text, comments). It runs the same
 * in Node and the browser, unlike DOMParser.
 */
export function parseXml(text: string): XmlNode {
  // XML normalizes CRLF/CR to LF before parsing. Windows checkouts otherwise leave a trailing
  // CR in multiline SRAM contents, making their last value on each line fail to parse.
  text = text.replace(/\r\n?/g, "\n");
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attr = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text)) !== null) {
    if (stack.length > 0 && m.index > last) stack[stack.length - 1].text += decodeEntities(text.slice(last, m.index));
    last = tag.lastIndex;
    if (m[1] !== undefined) {
      if (stack.length > 0) stack[stack.length - 1].text += m[1];
      continue;
    }
    if (m[3] === undefined) continue; // comment or declaration
    if (m[2] === "/") {
      const done = stack.pop();
      if (!done || done.tag !== m[3]) throw new CircuitParseError(`mismatched </${m[3]}>`);
      if (stack.length === 0) root = done;
      continue;
    }
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    attr.lastIndex = 0;
    while ((a = attr.exec(m[4])) !== null) attrs[a[1]] = decodeEntities(a[2] ?? a[3]);
    const node = new XmlNode(m[3], attrs);
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    if (m[5] === "/") {
      if (stack.length === 0) root = node;
    } else {
      stack.push(node);
    }
  }
  if (!root) throw new CircuitParseError("no root element");
  return root;
}

/** Escaping for free text embedded in the text format (CustomLogicModel.escape / unescape). */
export const CircuitText = {
  escape(s: string): string {
    if (s.length === 0) return "\\0";
    return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/ /g, "\\s").replace(/\+/g, "\\p")
      .replace(/=/g, "\\q").replace(/#/g, "\\h").replace(/&/g, "\\a").replace(/\r/g, "\\r");
  },

  unescape(s: string): string {
    if (s === "\\0") return "";
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const c = s[++i];
      if (c === undefined) break;
      out += ({ n: "\n", r: "\r", s: " ", p: "+", q: "=", h: "#", a: "&" } as Record<string, string>)[c] ?? c;
    }
    return out;
  },
};
