// Scope recordings: every scoped value at full resolution for the whole run, with a zoom pyramid,
// kept in memory while recent and spilled to temporary files when it grows (one folder per window).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

/**
 * A recording stores, for each of its traces, the min and max of the value over every cell of
 * time (level 0: one cell per max step, the solver's resolution), plus coarser copies (level L:
 * cells of 4^L level-0 cells) so a plot reads about one cell per pixel at any zoom.
 *
 * Cells live in chunks of CHUNK cells per level. Chunks are cached in memory (shared budget,
 * least recently used go first); evicted chunks are written to temporary files (the origin's
 * private file system) and read back on demand. Past the disk budget the oldest level-0 detail
 * is dropped, but coarser levels keep the whole run visible.
 */

const CHUNK = 8192;
const FANOUT = 4;
/** Memory for all recordings' chunks. */
const MEMORY_BUDGET = 64 * 1024 * 1024;
/** Temporary files for all recordings (lowered to half the storage quota when that's smaller). */
let diskBudget = 2 * 1024 * 1024 * 1024;
const DIR = "nodeforge-recordings";

interface Chunk {
  rec: Recording;
  level: number;
  index: number;
  /** min/max per cell and trace: data[(cell * traces + trace) * 2 + 0/1]; null while on disk only. */
  data: Float32Array | null;
  /** Changed since it was last written. */
  dirty: boolean;
  onDisk: boolean;
  loading: boolean;
  lastUse: number;
}

// MARK: storage

/** Temporary files in the origin private file system, or nothing (memory only) if unavailable. */
class FileStore {
  private dir: Promise<FileSystemDirectoryHandle | null>;

  constructor() {
    this.dir = (async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const base = await root.getDirectoryHandle(DIR, { create: true });
        // each window has its own folder, locked while the window is open, so another window
        // starting up can tell its files are in use; folders nobody holds are left from closed
        // windows (or a crash) and are deleted
        const session = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const locks = navigator.locks;
        if (locks) {
          await new Promise<void>((held) => {
            void locks.request(`${DIR}/${session}`, () => {
              held();
              return new Promise<void>(() => {}); // until the window closes
            });
          });
          const live = new Set(((await locks.query()).held ?? []).map((l) => l.name));
          const names: string[] = [];
          for await (const name of (base as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
          for (const name of names) if (!live.has(`${DIR}/${name}`)) await base.removeEntry(name, { recursive: true }).catch(() => undefined);
        }
        const est = await navigator.storage.estimate().catch(() => null);
        if (est?.quota) diskBudget = Math.min(diskBudget, est.quota * 0.5);
        return await base.getDirectoryHandle(session, { create: true });
      } catch {
        return null;
      }
    })();
  }

  async available(): Promise<boolean> {
    return (await this.dir) !== null;
  }

  async write(name: string, data: Float32Array): Promise<boolean> {
    const dir = await this.dir;
    if (!dir) return false;
    try {
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(data.slice().buffer);
      await w.close();
      return true;
    } catch {
      return false;
    }
  }

  async read(name: string): Promise<Float32Array | null> {
    const dir = await this.dir;
    if (!dir) return null;
    try {
      return new Float32Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
    } catch {
      return null;
    }
  }

  async remove(name: string): Promise<void> {
    const dir = await this.dir;
    await dir?.removeEntry(name).catch(() => undefined);
  }
}

/** All recordings' chunks: the memory cache and the temporary files behind it. */
class ChunkPool {
  private readonly chunks = new Set<Chunk>();
  private memory = 0;
  disk = 0;
  private clock = 0;
  private store: FileStore | null = null;
  private evicting = false;

  private files(): FileStore {
    return (this.store ??= new FileStore());
  }

  touch(c: Chunk): void {
    c.lastUse = ++this.clock;
  }

  add(c: Chunk): void {
    this.chunks.add(c);
    this.memory += c.data!.byteLength;
    this.touch(c);
    if (this.memory > MEMORY_BUDGET) void this.evict();
  }

  /** Free memory: write the least recently used chunks out (or drop them without a file store). */
  private async evict(): Promise<void> {
    if (this.evicting) return;
    this.evicting = true;
    try {
      const files = this.files();
      const canWrite = await files.available();
      while (this.memory > MEMORY_BUDGET * 0.8) {
        let victim: Chunk | null = null;
        for (const c of this.chunks) {
          // the chunk being written to stays
          if (!c.data || c.rec.isLive(c)) continue;
          if (!victim || c.lastUse < victim.lastUse) victim = c;
        }
        if (!victim) break;
        const size = victim.data!.byteLength;
        if (canWrite && (victim.dirty || !victim.onDisk)) {
          if (this.disk + size > diskBudget) this.makeRoom(size);
          if (this.disk + size <= diskBudget && (await files.write(victim.rec.fileName(victim), victim.data!))) {
            if (!victim.onDisk) this.disk += size;
            victim.onDisk = true;
            victim.dirty = false;
          }
        }
        // written (or nowhere to keep it: then its detail is gone)
        if (!victim.onDisk) victim.rec.dropped(victim);
        if (victim.data) this.memory -= size;
        victim.data = null;
        if (!victim.onDisk) this.chunks.delete(victim);
      }
    } finally {
      this.evicting = false;
    }
  }

  /** Over the disk budget: delete the oldest level-0 chunks on disk. */
  private makeRoom(size: number): void {
    const onDisk = [...this.chunks].filter((c) => c.onDisk && !c.data && c.level === 0).sort((a, b) => a.lastUse - b.lastUse);
    for (const c of onDisk) {
      if (this.disk + size <= diskBudget) break;
      void this.files().remove(c.rec.fileName(c));
      this.disk -= c.data?.byteLength ?? c.rec.chunkBytes();
      c.onDisk = false;
      c.rec.dropped(c);
      this.chunks.delete(c);
    }
  }

  /** Bring a chunk back from its file (asynchronously; plots redraw every frame). */
  load(c: Chunk): void {
    if (c.loading || c.data || !c.onDisk) return;
    c.loading = true;
    void this.files().read(c.rec.fileName(c)).then((data) => {
      c.loading = false;
      if (!data || c.data || !this.chunks.has(c)) return;
      c.data = data;
      this.memory += data.byteLength;
      this.touch(c);
      if (this.memory > MEMORY_BUDGET) void this.evict();
    });
  }

  /** Read export data directly without evicting other chunks or substituting coarse samples. */
  async exportData(c: Chunk): Promise<Float32Array | null> {
    return c.data ?? (c.onDisk ? await this.files().read(c.rec.fileName(c)) : null);
  }

  remove(c: Chunk): void {
    if (c.data) this.memory -= c.data.byteLength;
    if (c.onDisk) {
      this.disk -= c.rec.chunkBytes();
      void this.files().remove(c.rec.fileName(c));
    }
    this.chunks.delete(c);
  }
}

const pool = new ChunkPool();
let nextId = 1;

// MARK: recording

/** What a plot gets for one cell: its time span and, per trace, min and max. */
export type CellVisitor = (tStart: number, tEnd: number, data: Float32Array, offset: number) => void;

export class Recording {
  readonly id = nextId++;
  /** Cells per level (level 0 counts the cell being filled). */
  private counts: number[] = [0];
  /** Chunks per level, by chunk index. */
  private levels: Map<number, Chunk>[] = [new Map()];
  /** Level-0 cells before this one have lost their detail (disk budget, or no file store). */
  private detailFrom = 0;
  /** Time of the last sample. */
  end: number;
  private last: Float64Array;

  constructor(readonly traces: number, readonly start: number, readonly cell: number) {
    this.end = start;
    this.last = new Float64Array(traces);
  }

  chunkBytes(): number {
    return CHUNK * this.traces * 2 * 4;
  }

  fileName(c: Chunk): string {
    return `r${this.id}-L${c.level}-${c.index}`;
  }

  get levelCount(): number {
    return this.levels.length;
  }

  /** Seconds per cell at a level. */
  cellTime(level: number): number {
    return this.cell * FANOUT ** level;
  }

  /** The finest level whose cells are at least `seconds` long (about one cell per pixel). */
  levelFor(seconds: number): number {
    let l = 0;
    while (l + 1 < this.levels.length && this.cellTime(l) < seconds) l++;
    return l;
  }

  /** The chunk a level's cells are being written into. */
  isLive(c: Chunk): boolean {
    return c.index === Math.floor(Math.max(0, this.counts[c.level] - 1) / CHUNK);
  }

  dropped(c: Chunk): void {
    if (c.level === 0) this.detailFrom = Math.max(this.detailFrom, (c.index + 1) * CHUNK);
    this.levels[c.level]?.delete(c.index);
  }

  private chunk(level: number, index: number, create: boolean): Chunk | null {
    const map = this.levels[level];
    let c = map.get(index) ?? null;
    if (!c && create) {
      c = { rec: this, level, index, data: new Float32Array(CHUNK * this.traces * 2), dirty: true, onDisk: false, loading: false, lastUse: 0 };
      map.set(index, c);
      pool.add(c);
    }
    if (c) {
      pool.touch(c);
      if (!c.data) pool.load(c);
    }
    return c;
  }

  /** Widen (or start) cell k at a level with a sample. */
  private put(level: number, k: number, values: ArrayLike<number>, fresh: boolean): void {
    const c = this.chunk(level, Math.floor(k / CHUNK), true)!;
    if (!c.data) return; // being read back; the coarse levels still get it
    const base = (k % CHUNK) * this.traces * 2;
    for (let j = 0; j < this.traces; j++) {
      const v = values[j], o = base + j * 2;
      if (fresh || v < c.data[o]) c.data[o] = v;
      if (fresh || v > c.data[o + 1]) c.data[o + 1] = v;
    }
    c.dirty = true;
  }

  /** Add the traces' values at time t (times only go forward). */
  add(t: number, values: ArrayLike<number>): void {
    const k = Math.max(0, Math.floor((t - this.start) / this.cell + 1e-9));
    const cur = this.counts[0] - 1;
    // the first sample also stands for the time before it
    if (cur < 0) for (let j = 0; j < this.traces; j++) this.last[j] = values[j];
    if (k > cur) {
      // cells skipped since the last sample (a step longer than a cell) take the last value, so
      // the trace stays continuous
      for (let i = Math.max(cur + 1, 0, k - 100000); i < k; i++) this.addCell(i, this.last);
      this.addCell(k, values);
    } else {
      for (let l = 0; l < this.levels.length; l++) this.put(l, Math.floor(k / FANOUT ** l), values, false);
    }
    for (let j = 0; j < this.traces; j++) this.last[j] = values[j];
    this.end = Math.max(this.end, t);
  }

  /** Start level-0 cell k, and widen the coarser cells it falls in (adding levels as the run grows). */
  private addCell(k: number, values: ArrayLike<number>): void {
    this.counts[0] = k + 1;
    this.put(0, k, values, true);
    for (let l = 1; ; l++) {
      const kl = Math.floor(k / FANOUT ** l);
      if (l >= this.levels.length) {
        // a new level once the finest one spans more than a few cells
        if (k < FANOUT ** l * 2) break;
        this.levels.push(new Map());
        this.counts.push(0);
        // seed it from the level below
        this.seed(l);
      }
      const fresh = kl >= this.counts[l];
      if (fresh) this.counts[l] = kl + 1;
      this.put(l, kl, values, fresh);
    }
  }

  /** Fill a new level from the one below it (what's still in memory). */
  private seed(level: number): void {
    const below = this.counts[level - 1];
    for (let k = 0; k < below; k++) {
      const c = this.chunk(level - 1, Math.floor(k / CHUNK), false);
      if (!c?.data) continue;
      const base = (k % CHUNK) * this.traces * 2;
      const kl = Math.floor(k / FANOUT);
      const fresh = kl >= this.counts[level];
      if (fresh) this.counts[level] = kl + 1;
      const lo = new Float64Array(this.traces), hi = new Float64Array(this.traces);
      for (let j = 0; j < this.traces; j++) {
        lo[j] = c.data[base + j * 2];
        hi[j] = c.data[base + j * 2 + 1];
      }
      this.put(level, kl, lo, fresh);
      this.put(level, kl, hi, false);
    }
  }

  /** Can every cell of a level in [t0, t1] be read right now (no chunk missing or loading)? */
  available(level: number, t0: number, t1: number): boolean {
    if (level === 0 && t0 < this.start + this.detailFrom * this.cell) return false;
    const ct = this.cellTime(level);
    const k0 = Math.max(0, Math.floor((t0 - this.start) / ct)), k1 = Math.min(this.counts[level] - 1, Math.floor((t1 - this.start) / ct));
    for (let ci = Math.floor(k0 / CHUNK); ci <= Math.floor(k1 / CHUNK); ci++) {
      const c = this.chunk(level, ci, false);
      if (!c?.data) return false;
    }
    return true;
  }

  /** Visit a level's cells overlapping [t0, t1] (cells not in memory are skipped, and fetched). */
  visit(level: number, t0: number, t1: number, cb: CellVisitor): void {
    const ct = this.cellTime(level), n = this.counts[level];
    const k0 = Math.max(0, Math.floor((t0 - this.start) / ct)), k1 = Math.min(n - 1, Math.floor((t1 - this.start) / ct));
    for (let k = k0; k <= k1; k++) {
      const c = this.chunk(level, Math.floor(k / CHUNK), false);
      if (!c?.data) {
        k = (Math.floor(k / CHUNK) + 1) * CHUNK - 1;
        continue;
      }
      const tStart = this.start + k * ct;
      cb(tStart, Math.min(tStart + ct, Math.max(this.end, tStart)), c.data, (k % CHUNK) * this.traces * 2);
    }
  }

  /** The last n cells of a level, oldest first (for spectra); fewer if the run is shorter. */
  tail(level: number, n: number, cb: CellVisitor): void {
    const ct = this.cellTime(level);
    const k1 = this.counts[level] - 1;
    const t1 = this.start + k1 * ct;
    this.visit(level, t1 - (n - 1) * ct, t1, cb);
  }

  /** Export level-0 min/max cells. Never silently substitute lower-resolution data. */
  async exportCells(cb: CellVisitor, signal?: AbortSignal): Promise<void> {
    const count = this.counts[0], end = this.end;
    if (this.detailFrom) throw new Error("Full-resolution recording data has expired. Start a new recording before exporting.");
    if (!count) throw new Error("No recorded samples to export.");
    if (count > 1000000) throw new Error("CSV export is limited to 1000000 recording cells. Use a shorter recording.");
    for (let base = 0; base < count; base += CHUNK) {
      if (signal?.aborted) throw new Error("CSV export cancelled.");
      const chunk = this.levels[0].get(base / CHUNK);
      const data = chunk ? await pool.exportData(chunk) : null;
      if (!data) throw new Error("Recording data is unavailable. No CSV was exported.");
      for (let k = base; k < Math.min(base + CHUNK, count); k++) {
        const start = this.start + k * this.cell;
        cb(start, Math.min(start + this.cell, Math.max(end, start)), data, (k - base) * this.traces * 2);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (signal?.aborted) throw new Error("CSV export cancelled.");
  }

  /** Free the memory and delete the temporary files. */
  dispose(): void {
    for (const map of this.levels) for (const c of map.values()) pool.remove(c);
    this.levels = [new Map()];
    this.counts = [0];
  }
}
