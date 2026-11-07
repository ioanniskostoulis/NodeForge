// The few browser globals the interface modules touch, for running them under Node in tests.
const g = globalThis as Record<string, unknown>;
g.window ??= globalThis;
g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
g.matchMedia ??= () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
g.document ??= {
  documentElement: { dataset: {}, style: { setProperty() {} } },
  addEventListener() {},
  createElement: () => ({ getContext: () => null, style: {} }),
};
g.DOMMatrix ??= class {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  constructor(init?: number[]) {
    if (init) [this.a, this.b, this.c, this.d, this.e, this.f] = init;
  }
  multiply() { return this; }
  inverse() { return this; }
  translate() { return this; }
  scale() { return this; }
  transformPoint(p: { x: number; y: number }) { return p; }
};
