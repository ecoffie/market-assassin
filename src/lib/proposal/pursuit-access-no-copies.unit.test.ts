/**
 * Every pursuit route decides access through the ONE shared rule
 * (src/lib/proposal/pursuit-access.ts: canAccessPursuit / authorizePursuitRead).
 * A private copy of the rule is how a route drifts — e.g. matching only user_email and
 * 403'ing workspace pursuits. Order (check before read) is pinned separately in
 * pursuit-access-routes.unit.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES = ['pursuit-docs', 'compliance-state', 'chat', 'compliance', 'extract-sow', 'bid-gates'];

describe('pursuit routes use the shared access rule, never a copy', () => {
  for (const r of ROUTES) {
    it(r, () => {
      const src = readFileSync(join(process.cwd(), 'src/app/api/app/proposal', r, 'route.ts'), 'utf8');
      expect(src).toMatch(/from '@\/lib\/proposal\/pursuit-access'/);
      expect(src).toMatch(/\b(canAccessPursuit|authorizePursuitRead)\(/);
      expect(src).not.toMatch(/function ownsPursuit\b/);
      // The workspace half of the rule lives in the helper, not inline in a route.
      expect(src).not.toMatch(/resolveActiveWorkspace\(/);
    });
  }
});
