// Scope docking: move whole scopes without replacing their traces or recordings.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
export type ScopeDropEdge = "left" | "right" | "above" | "below";

export function moveScope<T extends { position: number }>(scopes: readonly T[], source: T, target: T, edge: ScopeDropEdge): T[] | null {
  if (!scopes.includes(source) || !scopes.includes(target)) return null;
  const columns = [...new Set(scopes.map((scope) => scope.position))].sort((a, b) => a - b)
    .map((position) => scopes.filter((scope) => scope.position === position));
  const targetColumn = columns.find((column) => column.includes(target))!;
  if (source === target && (edge === "above" || edge === "below" || targetColumn.length === 1)) return null;
  for (const column of columns) {
    const index = column.indexOf(source);
    if (index >= 0) column.splice(index, 1);
  }
  const groups = columns.filter((column) => column.length);
  if (edge === "left" || edge === "right") {
    const index = groups.indexOf(targetColumn);
    groups.splice(index + (edge === "right" ? 1 : 0), 0, [source]);
  } else {
    const index = targetColumn.indexOf(target);
    targetColumn.splice(index + (edge === "below" ? 1 : 0), 0, source);
  }
  const next = groups.flat();
  const positions = new Map<T, number>();
  groups.forEach((column, position) => column.forEach((scope) => positions.set(scope, position)));
  if (next.every((scope, index) => scope === scopes[index] && scope.position === positions.get(scope))) return null;
  for (const scope of next) scope.position = positions.get(scope)!;
  return next;
}
