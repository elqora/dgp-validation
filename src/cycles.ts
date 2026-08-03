// SPDX-License-Identifier: GPL-3.0-only

export function stronglyConnectedCycles(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const nodes = new Set<string>();
  for (const [node, targets] of edges) {
    nodes.add(node);
    for (const target of targets) nodes.add(target);
  }

  function visit(node: string): void {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of edges.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(target)!));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const group: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (current !== undefined) {
        onStack.delete(current);
        group.push(current);
      }
    } while (current !== node && current !== undefined);

    const selfCycle = group.length === 1
      && (edges.get(group[0]!) ?? []).includes(group[0]!);
    if (group.length > 1 || selfCycle) cycles.push(group.reverse());
  }

  for (const node of nodes) if (!indices.has(node)) visit(node);
  return cycles;
}
