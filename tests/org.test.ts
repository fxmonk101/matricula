import { describe, expect, it } from 'vitest';

import {
  buildOrgTree,
  flattenOrgTree,
  resolveManagerChain,
  resolveSubordinates,
  unitAndDescendants,
  wouldCreateCycle,
  type OrgNode,
  type ReportingNode,
} from '@/lib/domain/org';

/**
 * A department shaped like Golden Eagles' Faculty of Science:
 *
 *   dean
 *    ├── hod-csc
 *    │    ├── lecturer-a
 *    │    └── lecturer-b
 *    └── hod-mth
 *         └── lecturer-c
 *   registrar   (no manager; a separate line entirely)
 */
const LINE: ReportingNode[] = [
  { membershipId: 'dean', managerId: null },
  { membershipId: 'hod-csc', managerId: 'dean' },
  { membershipId: 'hod-mth', managerId: 'dean' },
  { membershipId: 'lecturer-a', managerId: 'hod-csc' },
  { membershipId: 'lecturer-b', managerId: 'hod-csc' },
  { membershipId: 'lecturer-c', managerId: 'hod-mth' },
  { membershipId: 'registrar', managerId: null },
];

describe('subordinate resolution', () => {
  it('reaches the whole subtree, not just direct reports', () => {
    expect(resolveSubordinates(LINE, 'dean')).toEqual(
      new Set(['hod-csc', 'hod-mth', 'lecturer-a', 'lecturer-b', 'lecturer-c']),
    );
  });

  it('scopes correctly to a middle manager', () => {
    expect(resolveSubordinates(LINE, 'hod-csc')).toEqual(new Set(['lecturer-a', 'lecturer-b']));
  });

  it('excludes the root — a manager is not their own subordinate', () => {
    // Otherwise "show my team's tasks" would include the manager's own queue.
    expect(resolveSubordinates(LINE, 'dean').has('dean')).toBe(false);
  });

  it('returns an empty set for a leaf', () => {
    expect(resolveSubordinates(LINE, 'lecturer-a').size).toBe(0);
  });

  it('returns an empty set for someone not in the graph at all', () => {
    expect(resolveSubordinates(LINE, 'nobody').size).toBe(0);
  });

  it('ignores a separate reporting line', () => {
    expect(resolveSubordinates(LINE, 'dean').has('registrar')).toBe(false);
  });

  it('terminates on a cycle instead of hanging', () => {
    // Two edits that each look reasonable in isolation produce this. An
    // unguarded traversal turns a data-entry mistake into an outage.
    const cyclic: ReportingNode[] = [
      { membershipId: 'a', managerId: 'c' },
      { membershipId: 'b', managerId: 'a' },
      { membershipId: 'c', managerId: 'b' },
    ];
    const out = resolveSubordinates(cyclic, 'a');
    expect(out).toEqual(new Set(['b', 'c']));
    expect(out.has('a')).toBe(false);
  });

  it('handles a self-managing membership', () => {
    const selfy: ReportingNode[] = [{ membershipId: 'a', managerId: 'a' }];
    expect(resolveSubordinates(selfy, 'a').size).toBe(0);
  });

  it('visits a diamond only once', () => {
    const diamond: ReportingNode[] = [
      { membershipId: 'top', managerId: null },
      { membershipId: 'left', managerId: 'top' },
      { membershipId: 'right', managerId: 'top' },
      { membershipId: 'bottom', managerId: 'left' },
    ];
    expect(resolveSubordinates(diamond, 'top')).toEqual(new Set(['left', 'right', 'bottom']));
  });
});

describe('the chain of command', () => {
  it('runs nearest manager first', () => {
    expect(resolveManagerChain(LINE, 'lecturer-a')).toEqual(['hod-csc', 'dean']);
  });

  it('is empty at the top', () => {
    expect(resolveManagerChain(LINE, 'dean')).toEqual([]);
  });

  it('stops when a cycle closes rather than looping forever', () => {
    const cyclic: ReportingNode[] = [
      { membershipId: 'a', managerId: 'b' },
      { membershipId: 'b', managerId: 'a' },
    ];
    expect(resolveManagerChain(cyclic, 'a')).toEqual(['b']);
  });

  it('respects the depth ceiling on a pathological chain', () => {
    const deep: ReportingNode[] = Array.from({ length: 100 }, (_, i) => ({
      membershipId: `n${i}`,
      managerId: i === 99 ? null : `n${i + 1}`,
    }));
    expect(resolveManagerChain(deep, 'n0', 5)).toHaveLength(5);
  });
});

describe('cycle prevention', () => {
  it('rejects self-management', () => {
    expect(wouldCreateCycle(LINE, 'dean', 'dean')).toBe(true);
  });

  it('rejects making a subordinate into your manager', () => {
    expect(wouldCreateCycle(LINE, 'dean', 'lecturer-a')).toBe(true);
  });

  it('allows a legitimate re-parenting', () => {
    expect(wouldCreateCycle(LINE, 'lecturer-a', 'hod-mth')).toBe(false);
  });

  it('allows attaching an unrelated line', () => {
    expect(wouldCreateCycle(LINE, 'registrar', 'dean')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
const UNITS: OrgNode[] = [
  { id: 'sci', parentId: null, code: 'SCI', name: 'Faculty of Science', kind: 'FACULTY' },
  { id: 'csc', parentId: 'sci', code: 'CSC', name: 'Computer Science', kind: 'DEPARTMENT' },
  { id: 'mth', parentId: 'sci', code: 'MTH', name: 'Mathematics', kind: 'DEPARTMENT' },
  { id: 'eng', parentId: null, code: 'ENG', name: 'Faculty of Engineering', kind: 'FACULTY' },
  { id: 'eee', parentId: 'eng', code: 'EEE', name: 'Electrical Engineering', kind: 'DEPARTMENT' },
];

describe('the org-unit tree', () => {
  it('returns a forest, because a school has several roots', () => {
    const roots = buildOrgTree(UNITS);
    expect(roots.map((r) => r.code)).toEqual(['ENG', 'SCI']);
  });

  it('nests and sorts children deterministically', () => {
    const sci = buildOrgTree(UNITS).find((r) => r.code === 'SCI');
    expect(sci?.children.map((c) => c.code)).toEqual(['CSC', 'MTH']);
  });

  it('assigns depth for indentation', () => {
    const flat = flattenOrgTree(buildOrgTree(UNITS));
    expect(flat.find((n) => n.code === 'SCI')?.depth).toBe(0);
    expect(flat.find((n) => n.code === 'CSC')?.depth).toBe(1);
  });

  it('promotes an orphan to a root rather than dropping it', () => {
    // A unit that vanishes from the org chart because of a bad parentId is far
    // harder to diagnose than one sitting at the top looking obviously wrong.
    const orphaned: OrgNode[] = [
      ...UNITS,
      { id: 'lost', parentId: 'does-not-exist', code: 'AAA', name: 'Orphan', kind: 'TEAM' },
    ];
    expect(buildOrgTree(orphaned).map((r) => r.code)).toContain('AAA');
    expect(flattenOrgTree(buildOrgTree(orphaned))).toHaveLength(6);
  });

  it('survives a cycle among units', () => {
    const cyclic: OrgNode[] = [
      { id: 'a', parentId: 'b', code: 'A', name: 'A', kind: 'TEAM' },
      { id: 'b', parentId: 'a', code: 'B', name: 'B', kind: 'TEAM' },
    ];
    const roots = buildOrgTree(cyclic);
    expect(roots).toHaveLength(2);
  });

  it('flattens depth-first so an indented list reads correctly', () => {
    expect(flattenOrgTree(buildOrgTree(UNITS)).map((n) => n.code)).toEqual([
      'ENG', 'EEE', 'SCI', 'CSC', 'MTH',
    ]);
  });

  it('scopes a report to a faculty and everything under it', () => {
    expect(unitAndDescendants(UNITS, 'sci')).toEqual(new Set(['sci', 'csc', 'mth']));
  });

  it('includes the unit itself even when it is a leaf', () => {
    expect(unitAndDescendants(UNITS, 'csc')).toEqual(new Set(['csc']));
  });

  it('terminates when units form a cycle', () => {
    const cyclic: OrgNode[] = [
      { id: 'a', parentId: 'b', code: 'A', name: 'A', kind: 'TEAM' },
      { id: 'b', parentId: 'a', code: 'B', name: 'B', kind: 'TEAM' },
    ];
    expect(unitAndDescendants(cyclic, 'a')).toEqual(new Set(['a', 'b']));
  });
});
