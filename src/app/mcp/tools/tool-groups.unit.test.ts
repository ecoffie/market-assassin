import { describe, it, expect } from 'vitest';
import { listMcpTools } from '@/lib/mcp/tool-registry';
import { TOOL_GROUPS, GROUPED_TOOL_NAMES, assertGroupCoverage } from './tool-groups';

/**
 * The /mcp/tools reference renders from the LIVE catalog, so a new tool can never
 * be missing from the page — but it CAN land in the "Everything else" bucket with
 * no editorial home. These tests make that a CI failure instead of a silent one.
 *
 * If you add a tool to the registry, add it to a group in tool-groups.ts.
 */
describe('/mcp/tools — group coverage', () => {
  const live = listMcpTools().map((t) => (t.function as { name: string }).name);

  it('every live tool is filed into a group', () => {
    const { missing } = assertGroupCoverage(live);
    expect(missing, `ungrouped tools — add them to a group in tool-groups.ts: ${missing.join(', ')}`).toEqual([]);
  });

  it('no group names a tool that no longer exists', () => {
    const { stale } = assertGroupCoverage(live);
    expect(stale, `stale entries — these are not on the live surface: ${stale.join(', ')}`).toEqual([]);
  });

  it('no tool is filed in two groups', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const g of TOOL_GROUPS) {
      for (const name of g.tools) {
        const first = seen.get(name);
        if (first) dupes.push(`${name} (in ${first} and ${g.id})`);
        else seen.set(name, g.id);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('the map and the live surface are the same size', () => {
    // Belt and braces: the two checks above imply this, but an exact count makes a
    // drift failure read clearly ("54 vs 53") instead of as a list diff.
    expect(GROUPED_TOOL_NAMES.size).toBe(live.length);
  });

  it('every group has a label, a blurb and at least one tool', () => {
    for (const g of TOOL_GROUPS) {
      expect(g.label.length, `${g.id} needs a label`).toBeGreaterThan(0);
      expect(g.blurb.length, `${g.id} needs a blurb`).toBeGreaterThan(0);
      expect(g.tools.length, `${g.id} has no tools`).toBeGreaterThan(0);
    }
  });
});
