import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs script, no type declarations
import { auditClaudeMd, ROOT_BUDGET_CHARS } from '../../../scripts/audit-claude-md.mjs';

const repo = path.resolve(__dirname, '../../..');
const read = (p: string) => { try { return fs.readFileSync(path.join(repo, p), 'utf8'); } catch { return null; } };
const exists = (p: string) => fs.existsSync(path.join(repo, p));

describe('instruction cleanup: no rule is silently lost', () => {
  it('the real split passes: every anchor present, root within budget, links resolve', () => {
    expect(auditClaudeMd({ read, exists })).toEqual([]);
  });

  it('deleting one rule from a reference file fails the audit', () => {
    const target = 'docs/agents/data-integrity.md';
    const tampered = (p: string) => (p === target ? read(p)!.replace('## Bug Prevention Rules', '## (removed)') : read(p));
    const failures: string[] = auditClaudeMd({ read: tampered, exists });
    expect(failures.some((f) => f.includes('Bug Prevention Rules'))).toBe(true);
  });

  it('dropping release-control rule 15 from the root fails the audit', () => {
    const tampered = (p: string) => (p === 'CLAUDE.md' ? read(p)!.replace(/15\. \*\*Release control/, '15. **Something else') : read(p));
    expect(auditClaudeMd({ read: tampered, exists }).some((f: string) => f.includes('CLAUDE.md'))).toBe(true);
  });

  it('root growing past its budget fails, and so does losing the hook-detected title', () => {
    const big = (p: string) => (p === 'CLAUDE.md' ? read(p)! + 'x'.repeat(ROOT_BUDGET_CHARS) : read(p));
    expect(auditClaudeMd({ read: big, exists }).some((f: string) => f.includes('budget'))).toBe(true);
    const retitled = (p: string) => (p === 'CLAUDE.md' ? read(p)!.replace('# Market Assassin', '# Mindy') : read(p));
    expect(auditClaudeMd({ read: retitled, exists }).some((f: string) => f.includes('SessionStart'))).toBe(true);
  });

  it('autonomous-deploy instructions are reworded, not deleted', () => {
    const rules = read('docs/agents/project-rules.md')!;
    expect(rules).not.toContain('Use `npm run deploy` (runs tests first)');
    expect(rules).toContain('[Release control 2026-11-17]');
    expect(read('docs/agents/release-and-worktrees.md')).toContain('Builders never run it');
  });
});
