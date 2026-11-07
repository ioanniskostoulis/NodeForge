// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { AnalysisInput, Recommendation } from "./recommend";

/**
 * Runs circuit analyses in a background worker, one at a time. Cancelling stops the worker
 * outright (an analysis can't be interrupted from outside otherwise); the next one starts a
 * fresh worker.
 */
export class Analyzer {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: { id: number; resolve: (result: Recommendation) => void; reject: (error: Error) => void } | null = null;

  get busy(): boolean {
    return this.pending !== null;
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }

  run(input: AnalysisInput): Promise<Recommendation> {
    this.cancel();
    const worker = (this.worker ??= this.start());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      worker.postMessage({ id, input });
    });
  }

  /** Abandon the running analysis, if any (its promise rejects). */
  cancel(): void {
    if (!this.pending) return;
    this.worker?.terminate();
    this.worker = null;
    const pending = this.pending;
    this.pending = null;
    pending.reject(new Error("cancelled"));
  }

  private start(): Worker {
    const worker = new Worker("recommend-worker.js");
    worker.onmessage = (event: MessageEvent<{ id: number; result?: Recommendation; error?: string }>) => {
      const pending = this.pending;
      if (!pending || pending.id !== event.data.id) return;
      this.pending = null;
      if (event.data.result) pending.resolve(event.data.result);
      else pending.reject(new Error(event.data.error ?? "analysis failed"));
    };
    worker.onerror = (event) => {
      const pending = this.pending;
      this.pending = null;
      this.worker = null;
      pending?.reject(new Error(event.message || "analysis failed"));
    };
    return worker;
  }
}
