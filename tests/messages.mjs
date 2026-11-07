// The Messages log: entries in order, a count of unseen problems, standing conditions logged once.
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { ConditionWatch, MessageLog, messageLines } from "./source/app/messages";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error",
});
const { ConditionWatch, MessageLog, messageLines } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

// results don't count as unseen; problems do, until the log is shown
{
  const log = new MessageLog();
  log.add("info", "Saved a.xml");
  assert.equal(log.unseen, 0);
  log.add("warning", "w");
  log.add("error", "e");
  assert.equal(log.unseen, 2);
  log.markSeen();
  assert.equal(log.unseen, 0);
  assert.deepEqual(log.entries.map((m) => m.kind), ["info", "warning", "error"]);
  const part = {};
  log.add("error", "SPICE model X isn't defined", part);
  assert.match(messageLines(log, (p) => (p === part ? "D1" : null)).at(-1), /^\d\d:\d\d:\d\d  Error    D1: SPICE model X isn't defined$/);
  log.clear();
  assert.equal(log.entries.length, 0);
}
// the log keeps the newest entries
{
  const log = new MessageLog();
  for (let i = 0; i < MessageLog.LIMIT + 10; i++) log.add("info", String(i));
  assert.equal(log.entries.length, MessageLog.LIMIT);
  assert.equal(log.entries[0].text, "10");
}
// a condition is logged when it appears, not again while it stays or flickers, and again once it
// comes back after a while
{
  const log = new MessageLog(), watch = new ConditionWatch();
  const stop = [["stop a", "error", "Simulation stopped: a"]];
  watch.update(log, stop, 0);
  watch.update(log, stop, 500);
  watch.update(log, [], 1000);
  watch.update(log, stop, 1500);
  assert.equal(log.entries.length, 1);
  watch.update(log, [], 2000);
  watch.update(log, [...stop, ["p", "warning", "x"]], 1500 + ConditionWatch.QUIET_MS + 1);
  assert.equal(log.entries.length, 3);
}
console.log("messages: ok");
