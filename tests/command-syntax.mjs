// Every command syntax and every literal tooltip follows the wording rules of the shell.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { CONSOLE_COMMANDS, SCOPE_SUBCOMMANDS, PLOT_SUBCOMMANDS } from "./source/app/commands";
    export { checkCommandSyntax } from "forge-shell/app/command-help";
    export { checkTipWording } from "forge-shell/app/tips";`, resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error",
});
const { CONSOLE_COMMANDS, SCOPE_SUBCOMMANDS, PLOT_SUBCOMMANDS, checkCommandSyntax, checkTipWording } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

const problems = [];
for (const command of CONSOLE_COMMANDS) {
  problems.push(...checkCommandSyntax(command.syntax));
  for (const sub of command.subcommands ?? []) problems.push(...checkCommandSyntax(sub.syntax));
}
for (const sub of [...SCOPE_SUBCOMMANDS, ...PLOT_SUBCOMMANDS]) problems.push(...checkCommandSyntax(sub.syntax));
// descriptions: one fragment of at most 70 characters, an initial capital and no final period
for (const { name, description } of CONSOLE_COMMANDS) {
  if (description.length > 70 || /\.$/.test(description) || !/^[A-Z]/.test(description)) problems.push(`${name}: description "${description}"`);
}
assert.deepEqual(problems, [], `command syntax:\n${problems.join("\n")}`);

// literal tooltips: setTip(element, "text")
const tips = [];
for (const file of readdirSync("source/app").filter((name) => name.endsWith(".ts"))) {
  const text = readFileSync(`source/app/${file}`, "utf8");
  for (const match of text.matchAll(/setTip\(\s*[\w.\[\]()]+,\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) tips.push([file, match[1]]);
}
const tipProblems = tips.flatMap(([file, tip]) => checkTipWording(tip).map((problem) => `${file}: ${problem}`));
console.log(`${CONSOLE_COMMANDS.length} commands and ${tips.length} literal tooltips checked.`);
assert.deepEqual(tipProblems, [], `tooltip wording:\n${tipProblems.join("\n")}`);
