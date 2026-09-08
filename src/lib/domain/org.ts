/**
 * =============================================================================
 * ORGANISATIONAL HIERARCHY
 * =============================================================================
 *
 * Pure graph algorithms over the reporting line and the org-unit tree. The
 * database enforces neither acyclicity nor depth, so every traversal here is
 * written to terminate on a malformed graph rather than to assume a well-formed
 * one.
 *
 * That is not defensive padding. `Membership.managerId` is editable by an
 * administrator through a form; two edits that each look reasonable in
 * isolation ("A reports to B", "B reports to A") produce a cycle, and an
 * unguarded traversal of it hangs the request thread that discovers it —
 * turning a data-entry mistake into an outage.
 */

export interface ReportingNode {
  membershipId: string;
  managerId: string | null;
}

/**
 * ALGORITHM: SUBORDINATE RESOLUTION (iterative BFS)
 * ------------------------------------------------
 * Everyone below `rootMembershipId` in the reporting line, transitively.
 *
 * Iterative rather than recursive: the depth is data, not a constant, and a
 * cycle would blow the stack before any guard in a recursive version ran.
 *
 * `visited` doubles as the cycle guard and the result. A node already visited
 * is never expanded twice, so a cycle terminates on its second lap instead of
 * spinning. The root is excluded from the result — a manager is not their own
 * subordinate, and including them would make "show my team's tasks" show the
 * manager's own queue as well.
 *
 * Complexity is O(V + E) with one index build, versus one query per level for
 * the recursive-descent version.
 */
export function resolveSubordinates(
  nodes: readonly ReportingNode[],
  rootMembershipId: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.managerId === null) continue;
    const list = childrenOf.get(node.managerId);
    if (list) list.push(node.membershipId);
    else childrenOf.set(node.managerId, [node.membershipId]);
  }

  const visited = new Set<string>();
  const queue: string[] = [...(childrenOf.get(rootMembershipId) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    // Already seen: either a diamond in the graph or a cycle. Either way there
    // is nothing new below it.
    if (visited.has(current)) continue;
    // A cycle that runs back through the root must not add the root to its own
    // subordinate set.
    if (current === rootMembershipId) continue;
    visited.add(current);
    queue.push(...(childrenOf.get(current) ?? []));
  }

  return visited;
}

/**
 * The chain of command above a membership, nearest manager first.
 *
 * Used for escalation ("who do I tell?") and for breadcrumbs. Terminates on a
 * cycle by the same visited-set argument as above; the chain it returns in that
 * case is the prefix before the loop closes, which is the useful part anyway.
 */
export function resolveManagerChain(
  nodes: readonly ReportingNode[],
  membershipId: string,
  maxDepth = 32,
): string[] {
  const byId = new Map(nodes.map((n) => [n.membershipId, n]));
  const chain: string[] = [];
  const seen = new Set<string>([membershipId]);

  let current = byId.get(membershipId)?.managerId ?? null;
  while (current !== null && chain.length < maxDepth) {
    if (seen.has(current)) break;
    seen.add(current);
    chain.push(current);
    current = byId.get(current)?.managerId ?? null;
  }
  return chain;
}

/**
 * Would setting `manager` as the manager of `member` create a cycle?
 *
 * Called before the write, because the cheapest place to reject a cycle is
 * before it exists. Self-management is the degenerate case and is rejected too.
 */
export function wouldCreateCycle(
  nodes: readonly ReportingNode[],
  memberId: string,
  proposedManagerId: string,
): boolean {
  if (memberId === proposedManagerId) return true;
  // A cycle forms exactly when the proposed manager already reports, however
  // indirectly, to the member.
  return resolveSubordinates(nodes, memberId).has(proposedManagerId);
}

// -----------------------------------------------------------------------------
// Org-unit tree
// -----------------------------------------------------------------------------

export interface OrgNode {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  kind: string;
}

export interface OrgTreeNode extends OrgNode {
  depth: number;
  children: OrgTreeNode[];
}

/**
 * Build the org-unit forest.
 *
 * Returns a FOREST, not a tree: a school legitimately has several roots
 * (Faculty of Science and the Bursary are both top-level), and any node whose
 * parent is missing or forms a cycle is promoted to a root rather than
 * silently dropped. A unit that vanishes from the org chart because of a bad
 * `parentId` is far harder to diagnose than one sitting at the top level
 * looking obviously wrong.
 */
export function buildOrgTree(nodes: readonly OrgNode[]): OrgTreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  /** True when following parents from `id` reaches a cycle. */
  const inCycle = (id: string): boolean => {
    const seen = new Set<string>();
    let current: string | null = id;
    while (current !== null) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
    return false;
  };

  const made = new Map<string, OrgTreeNode>(
    nodes.map((n) => [n.id, { ...n, depth: 0, children: [] }]),
  );
  const roots: OrgTreeNode[] = [];

  for (const node of nodes) {
    const made_ = made.get(node.id) as OrgTreeNode;
    const parent = node.parentId === null ? null : made.get(node.parentId);
    if (!parent || inCycle(node.id)) roots.push(made_);
    else parent.children.push(made_);
  }

  const setDepth = (node: OrgTreeNode, depth: number): void => {
    node.depth = depth;
    node.children.sort((a, b) => a.code.localeCompare(b.code));
    for (const child of node.children) setDepth(child, depth + 1);
  };
  roots.sort((a, b) => a.code.localeCompare(b.code));
  for (const root of roots) setDepth(root, 0);

  return roots;
}

/** Depth-first flattening, for rendering an indented list. */
export function flattenOrgTree(roots: readonly OrgTreeNode[]): OrgTreeNode[] {
  const out: OrgTreeNode[] = [];
  const walk = (node: OrgTreeNode) => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** A unit and everything beneath it, for scoping a report to a faculty. */
export function unitAndDescendants(
  nodes: readonly OrgNode[],
  rootId: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n.id);
    else childrenOf.set(n.parentId, [n.id]);
  }

  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of childrenOf.get(current) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}
