import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hasProAccess = vi.fn();
vi.mock('@/lib/access/resolve-access', () => ({ hasProAccess: (e: string) => hasProAccess(e) }));

import { canUseAskMindy } from './chat-access';

describe('canUseAskMindy', () => {
  afterEach(() => hasProAccess.mockReset());

  it('verified staff on a company domain can use Ask Mindy without a paid plan (2026-11-24 regression)', async () => {
    hasProAccess.mockResolvedValue(false);
    expect(await canUseAskMindy('branden@govcongiants.com')).toBe(true);
    expect(await canUseAskMindy('someone@getmindy.ai')).toBe(true);
    expect(hasProAccess).not.toHaveBeenCalled();
  });

  it('a non-staff user needs Pro', async () => {
    hasProAccess.mockResolvedValue(false);
    expect(await canUseAskMindy('customer@example.com')).toBe(false);
    hasProAccess.mockResolvedValue(true);
    expect(await canUseAskMindy('customer@example.com')).toBe(true);
  });

  it('every Ask Mindy route uses it, right after verifyUserOwnsEmail (no hasProAccess-only gate left)', () => {
    const root = join(__dirname, '..', '..', '..');
    for (const f of [
      'src/app/api/app/chat/route.ts',
      'src/app/api/app/chat-sessions/route.ts',
      'src/app/api/app/rag-doc/route.ts',
      'src/app/api/app/chat/documents/route.ts',
    ]) {
      const src = readFileSync(join(root, f), 'utf8');
      expect(src, f).toContain('canUseAskMindy(');
      expect(src, f).not.toMatch(/await hasProAccess\(/);
      expect(src.indexOf('verifyUserOwnsEmail(request'), f).toBeLessThan(src.indexOf('canUseAskMindy('));
    }
  });
});
